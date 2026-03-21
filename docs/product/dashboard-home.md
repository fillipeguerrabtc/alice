# Home da Dashboard da Alice

**Author:** Fillipe Guerra
**Data:** 21 de Marco de 2026
**Atualizado:** 21 de Marco de 2026
**Status:** ativo
**Tipo:** ssot

## Objetivo

Definir o comportamento vigente da home inicial da dashboard da Alice, incluindo prioridades de UX, modelo de cards configuráveis, persistência por usuário e regras de carregamento progressivo.

## Princípios vigentes

- A home deve renderizar um shell útil antes da conclusão de todos os dados secundários.
- Não existe mais dependência de um payload monolítico como caminho principal de first useful render.
- O conteúdo padrão deve ser mais enxuto que a home histórica.
- Cards carregam de forma independente ou por fonte compartilhada, com loading, erro e empty state próprios.
- Configuração do usuário usa exclusivamente `users.preferencias.dashboardHome`.
- Preferências inválidas, órfãs, incompatíveis ou sem permissão são saneadas antes de uso e persistência.
- A composição da home deve respeitar RBAC, tenant ativo e contratos reais do monorepo.

## Modelo de composição

### Shell da home

- Botão global de engrenagem no topo esquerdo.
- Headline curta e foco em leitura operacional.
- Contagem de cards ativos visível no topo.
- A configuração global deve permitir habilitar, desabilitar e abrir a configuração contextual de cada card.

### Cards acima da dobra

Defaults ativos para usuários com permissão compatível:

- `actionRequired`
- `supportQueue`
- `conversationTrend`

Esses cards concentram o sinal operacional inicial e devem carregar antes dos cards secundários.

### Cards abaixo da dobra

Cards secundários disponíveis conforme permissão:

- `recentActivity`
- `platformHealth`
- `routingSnapshot`
- `trainingSnapshot`
- `financeSnapshot`

Cards secundários podem iniciar após o primeiro paint da dobra superior, desde que isso não prejudique acessibilidade nem navegação.

## Preferências por usuário

`dashboardHome` vive dentro de `users.preferencias` com estrutura versionada.

Campos vigentes:

- `dashboardHome.version`
- `dashboardHome.visibleCardIds`
- `dashboardHome.cards[cardId].enabled`
- `dashboardHome.cards[cardId].timeRange`
- `dashboardHome.cards[cardId].metricSet`
- `dashboardHome.cards[cardId].limit`

## Saneamento e compatibilidade

- O saneamento remove cards inexistentes, desduplicações inválidas e opções fora das capabilities do card.
- Cards sem permissão saem da composição e não reaparecem na persistência saneada.
- Defaults são reintroduzidos apenas para cards permitidos e habilitados por padrão.
- A home opera com preferência resolvida, nunca com o payload bruto vindo do banco.

## Carregamento de dados

### Fonte rápida

- `GET /api/dashboard/home/config`

Retorna:

- permissões reais da home
- preferências saneadas
- lista de cards disponíveis
- lista de cards ativos

### Fontes progressivas

- `GET /api/dashboard/home/sources/priority`
- `GET /api/dashboard/home/sources/conversation-trend`
- `GET /api/dashboard/home/sources/platform-health`
- `GET /api/dashboard/home/sources/recent-activity`
- `GET /api/dashboard/home/sources/routing-snapshot`
- `GET /api/dashboard/home/sources/training-snapshot`
- `GET /api/dashboard/home/sources/finance-snapshot`

## Configuração contextual por card

Cada card configurável expõe uma engrenagem própria com:

- toggle de habilitação
- tipos de dado suportados pelo card
- janelas suportadas pelo card
- limite quando aplicável

Mudanças contextuais devem preservar estabilidade visual. Sempre que possível, o frontend reaproveita datasets já carregados para trocar janela ou métrica sem piscar vazio.

## Persistência

- `PUT /api/dashboard/home/preferences`

Regras:

- recebe a preferência completa da home
- saneia conforme permissões reais
- persiste via fluxo existente de atualização de `users.preferencias`
- devolve a preferência resolvida aplicada

## Observabilidade funcional

- Falhas de uma fonte não podem bloquear o restante da home.
- Cada card precisa oferecer retry isolado.
- O endpoint histórico `/api/dashboard/home` pode existir por compatibilidade, mas não é mais a fonte primária da nova home.
