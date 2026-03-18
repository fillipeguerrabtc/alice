# Esteira Enterprise 2026

**Author:** Fillipe Guerra  
**Data:** 17 de Março de 2026  
**Atualizado:** 17 de Março de 2026

## Objetivo

Consolidar o estado final da esteira enterprise 2026 do monorepo Alice com foco em:

- arquitetura vigente da validação local e dos gates full
- estratégia atual de bundling dos microsserviços Node
- benchmark final com baseline original versus estado atual
- relação entre changed-only, caches, references, release, retag e deploy
- riscos residuais e backlog futuro

## Arquitetura final da esteira

### Fluxo local padrão

Os comandos locais padrão do root são changed-only por design:

- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`
- `pnpm build`

O resolvedor fica em:

- `scripts/workspace-scope.mjs`
- `scripts/run-scoped-task.mjs`
- `scripts/test-scope.mjs`
- `scripts/run-scoped-test.mjs`

### Gates full manuais

Os comandos full continuam disponíveis para auditoria manual, troubleshooting e fallback explícito:

- `pnpm typecheck:full`
- `pnpm lint:full`
- `pnpm test:full`
- `pnpm build:full`
- `pnpm validate:enterprise`

No estado atual, `typecheck:full` ainda recompõe upstream compartilhado por `dependsOn` do `turbo.json` antes de validar workspaces dependentes. Isso foi confirmado no benchmark real de 17 de Março de 2026. O gate oficial do dia a dia, porém, fica concentrado no `CI` incremental.

### Changed-only

O changed-only local usa:

- `git diff` + arquivos untracked
- grafo real de workspaces lido de `apps/*/package.json` e `packages/*/package.json`
- classificação documental que ignora Markdown fora de `docs/` em mudanças puramente documentais
- expansão transitiva de dependentes quando necessário
- fail-safe para execução full diante de incerteza

Arquivos globais críticos continuam forçando full local. Entre eles:

- `scripts/build-service.mjs`
- `package.json`
- `pnpm-lock.yaml`
- `turbo.json`
- `tsconfig.build.json`
- `packages/tsconfig.base.json`

## Caches, incremental e references

### Turbo

- diretório: `.cache/turbo`
- `build` depende de `^build`
- `typecheck` depende de `^build`
- `lint` não gera artefato

### TypeScript incremental

Todos os apps Node e o frontend usam `incremental` com `tsBuildInfoFile` fora de `node_modules`, em `.cache/typescript/...`.

### Project references

O grafo formal de references do TypeScript continua concentrado em `packages/`:

- `tsconfig.build.json` referencia `shared`, `shared-utils`, `config`, `logger` e `database`
- `packages/config` referencia `packages/logger`
- `packages/database` referencia `packages/shared` e `packages/logger`
- `packages/shared-utils` referencia `packages/config`, `packages/logger` e `packages/database`
- `apps/frontend-service` referencia `packages/shared`, `packages/shared-utils` e `tsconfig.node.json`

Conclusão operacional:

- `packages/` já está preparado para compilação incremental e reaproveitamento de cache
- os apps backend continuam independentes no `tsc --noEmit`, mas o build runtime dos serviços empacotados segue em `esbuild`

## Boundaries de packages

### Boundaries vigentes

- código de serviço fica em `apps/*`
- código compartilhado fica em `packages/*`
- dependências internas são declaradas via `workspace:*`
- o frontend consome somente subpaths públicos necessários de `@alice/shared` e `@alice/shared-utils`

### Consequência direta no bundling

Os serviços Node que usam `scripts/build-service.mjs` fazem bundle inline do código `@alice/*`, mas externalizam dependências externas do serviço e também as dependências externas descobertas em `packages/*`.

Isso mantém o runtime dos microsserviços autocontido para código interno, sem embutir `node_modules` problemáticos com `require()` dinâmico.

## Estratégia atual de bundling

### Estado confirmado

Serviços validados com build real em 17 de Março de 2026:

- `@alice/auth-service`
- `@alice/chat-service`
- `@alice/gpu-manager-service`
- `@alice/integrations-service`
- `@alice/llm-gateway-service`
- `@alice/rag-service`
- `@alice/training-service`

Todos concluíram com sucesso antes de qualquer ajuste, então não houve bloqueio de estabilidade para revisar bundling com segurança.

### Melhoria pequena e segura aplicada

Foi mantida a estratégia atual de bundling e ajustado apenas `scripts/build-service.mjs` para:

- ordenar deterministicamente a coleta de `packages/*`
- expor no log o custo real do código do serviço versus o custo inline de `@alice/*` no bundle final

Não foi feita mudança estrutural de estratégia.

### Conclusão objetiva sobre bundling

- o bundling atual está estável
- `node_modules` permanece externalizado no runtime dos serviços empacotados
- o custo inline relevante está concentrado em código `@alice/*`
- não existe, dentro deste chat, uma troca pequena e segura de estratégia que reduza esse custo sem alterar contratos de packages, Docker build context, release diffing e comportamento de runtime

Qualquer passo além do ajuste de observabilidade exigiria mudança estrutural e ficou fora do escopo.

### Custo atual do inline bundling de `@alice/*`

Medição consolidada a partir do `metafile` do `esbuild` no build real de 17 de Março de 2026:

| Serviço | Bundle final | Código do serviço | Código inline de `@alice/*` | Participação inline |
|---|---:|---:|---:|---:|
| `auth-service` | 873.6 kB | 218.7 kB | 650.5 kB | 74.5% |
| `chat-service` | 1.6 MB | 844.4 kB | 747.5 kB | 46.8% |
| `gpu-manager-service` | 490.1 kB | 95.5 kB | 391.1 kB | 79.8% |
| `integrations-service` | 2.1 MB | 1.4 MB | 739.9 kB | 33.7% |
| `llm-gateway-service` | 515.4 kB | 102.6 kB | 409.2 kB | 79.4% |
| `rag-service` | 756.5 kB | 305.8 kB | 446.6 kB | 59.0% |
| `training-service` | 1.4 MB | 637.8 kB | 795.7 kB | 55.2% |

Leitura prática:

- serviços menores e mais orquestradores, como `gpu-manager-service` e `llm-gateway-service`, dependem proporcionalmente mais do código compartilhado inline
- serviços mais pesados em domínio próprio, como `integrations-service`, concentram o peso no código do próprio app

## Benchmark final

### Baseline original

Baseline original já documentado em `docs/engineering/validation-monorepo.md`:

| Comando | Tempo original |
|---|---:|
| `pnpm typecheck` | 1m13.45s |
| `pnpm lint` | 1m26.79s |
| `pnpm build` | 5m40.19s |

### Estado atual medido em 17 de Março de 2026

Comandos executados no host local em `/mnt/c/APPs/alice`:

- `2026-03-17T05:01:00-03:00` — `/usr/bin/time -f 'ELAPSED_SECONDS=%e' pnpm typecheck:full`
- `2026-03-17T05:04:37-03:00` — `/usr/bin/time -f 'ELAPSED_SECONDS=%e' pnpm lint:full`
- `2026-03-17T05:07:18-03:00` — `/usr/bin/time -f 'ELAPSED_SECONDS=%e' pnpm build:full`

| Comando | Tempo atual | Diferença vs baseline original |
|---|---:|---:|
| `pnpm typecheck:full` | 3m21.53s | +2m08.08s |
| `pnpm lint:full` | 2m33.77s | +1m06.98s |
| `pnpm build:full` | 3m01.48s | -2m38.71s |

### Escopos principais medidos localmente

Comandos executados em série com `/usr/bin/time -f 'ELAPSED_SECONDS=%e'`:

| Data/hora | Escopo | Tempo |
|---|---|---:|
| `2026-03-17T05:10:50-03:00` | `pnpm --filter @alice/auth-service typecheck` | 57.66s |
| `2026-03-17T05:11:48-03:00` | `pnpm --filter @alice/auth-service lint` | 63.91s |
| `2026-03-17T05:12:52-03:00` | `pnpm --filter @alice/auth-service build` | 6.50s |
| `2026-03-17T05:12:58-03:00` | `pnpm --filter @alice/api-gateway typecheck` | 57.82s |
| `2026-03-17T05:13:56-03:00` | `pnpm --filter @alice/api-gateway lint` | 62.43s |
| `2026-03-17T05:14:59-03:00` | `pnpm --filter @alice/api-gateway build` | 76.18s |
| `2026-03-17T05:16:15-03:00` | `pnpm --filter @alice/frontend-service typecheck` | 94.77s |
| `2026-03-17T05:17:50-03:00` | `pnpm --filter @alice/frontend-service lint` | 73.85s |
| `2026-03-17T05:19:03-03:00` | `pnpm --filter @alice/frontend-service build` | 154.49s |

### Leitura do benchmark

- o ganho estrutural mais claro está em `build:full`, hoje bem menor que o baseline original
- `typecheck` e `lint` continuam mais caros que o baseline original, coerente com o crescimento do monorepo e com o custo de I/O local em `/mnt/c`
- no backend empacotado, o build em si não é o gargalo principal
- `api-gateway`, que usa `tsc` puro no build, custa mais que um serviço backend empacotado
- o frontend segue como maior custo unitário entre os escopos principais medidos

## Relação com release, retag e deploy

### Release

O release continua independente do changed-only local para build/retag de imagens, mas não repete mais o gate de qualidade do `CI`.

Pontos confirmados em `.github/workflows/release.yml`:

- o workflow parte do pressuposto de que a revisão de qualidade já foi aprovada no `CI`
- mudanças em `scripts/`, `tsconfig*`, lockfile e contratos globais acionam `FORCE_ALL_MICROS=1`
- mudanças em `packages/*` usam impacto transitivo para rebuild das imagens Node afetadas
- na ausência de impacto detectado, o release pode optar por `retag`

Consequência:

- uma mudança em `scripts/build-service.mjs` já é tratada como mudança global de build no release e força rebuild dos microservices, evitando retag incorreto

### Retag

O retag continua governado por `scripts/release-functions.sh` com:

- `should_build`
- `image_exists`
- `retag_image`
- `decide_build_or_retag`

Se houver incerteza, ausência de imagem anterior ou falha parcial de release anterior, o comportamento continua fail-closed para build.

### Deploy

O deploy continua desacoplado em `.github/workflows/deploy-stack-modular.yml`:

- recebe da release a lista `built_images`
- diferencia build real de retag
- usa smart pull local e evita downloads desnecessários quando a release apenas retaggeou

Conclusão:

- changed-only local melhora custo de validação do desenvolvedor
- release e deploy preservam o gate enterprise conservador e a governança de retag

## Impacto do repositório em `/mnt/c` no WSL

### Evidência objetiva coletada

Comando executado em 17 de Março de 2026:

- `stat -f -c '%T %m' .`
- `mount | rg '/mnt/c'`
- `uname -a`

Resultado objetivo:

- filesystem do workspace reportado como `v9fs`
- mount do repositório em `C:\\ on /mnt/c type 9p`
- ambiente: `WSL2`

### Leitura operacional

Inferência suportada por essa evidência:

- workloads com muita leitura de árvore e metadata, como `lint`, `typecheck` e parte do `vite build`, sofrem impacto maior em `/mnt/c` do que builds mais CPU-bound e curtos

### Recomendação operacional

- manter comparações históricas sempre no mesmo tipo de mount para benchmark justo
- se o objetivo for somente performance local de validação, considerar uma cópia operacional do repo em filesystem Linux do WSL
- não mover automaticamente o repositório atual; a decisão continua manual

## Riscos residuais

- o custo inline de `@alice/*` ainda é alto em vários serviços e continuará crescendo enquanto a fronteira runtime permanecer centrada em bundle inline
- `api-gateway` permanece com build via `tsc`, então não participa dos mesmos ganhos operacionais de empacotamento dos demais serviços Node
- `typecheck` e `lint` full continuam sensíveis ao crescimento do monorepo e ao custo de I/O do mount Windows no WSL2
- uma revisão estrutural de bundling exigiria alinhar packages, Dockerfiles, release diffing e contratos de runtime; isso não foi iniciado neste chat

## Backlog futuro

- avaliar uma estratégia estrutural para reduzir o inline bundling de `@alice/*` sem perder isolamento de runtime
- revisar se `api-gateway` deve permanecer em `tsc` puro ou convergir para uma estratégia homogênea de build
- aprofundar benchmark em filesystem Linux nativo do WSL para separar custo de toolchain versus custo do mount `/mnt/c`
- criar série histórica de benchmark com cache frio e cache quente para `typecheck`, `lint` e `build`
- monitorar crescimento do peso inline de `packages/shared-utils` e `packages/database`, hoje mais relevantes para serviços orquestradores
