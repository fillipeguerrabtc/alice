# Arquitetura de Auth e Bootstrap do Trading

**Author:** Fillipe Guerra
**Data:** 18 de Marco de 2026
**Atualizado:** 18 de Marco de 2026

## Objetivo

Descrever a ordem correta de inicializacao das telas de Trading Real e Demo Trading, evitando corrida entre auth, status, queries de dados e conexao WebSocket.

## Sequencia canonica de bootstrap

1. `useAuth()` resolve usuario, CSRF e estado autenticado.
2. A pagina espera `isLoading` terminar antes de montar o restante do dominio.
3. Sem `user?.id`, a UI cai para tela de autenticacao obrigatoria.
4. Com `csrfReady`, a pagina consulta `GET /api/integrations/trading/status`.
5. Somente apos `status` e configuracao valida entram queries de dados, simbolos e paineis da workspace.
6. WebSocket so conecta quando auth, simbolo valido e configuracao estiverem prontos.

## Regras de implementacao

- `useAuth` nao deve gerar retentativa infinita de `401`.
- `csrfReady` e o sinal que libera as queries dependentes.
- `GET /api/integrations/trading/status` tambem entrega `featureFlags.tradingWorkspaceV2Enabled`.
- A Demo usa `GET /api/integrations/demo-trading/balance` como endpoint canonico de saldo.
- Queries de Trading e Demo nao devem disparar antes de `user?.id`.

## Responsabilidades por camada

### Frontend

- `Trading.tsx`, `TradingContent.tsx` e `DemoTrading.tsx` fazem o gating inicial.
- `apiRequest` suporta `tenantId` quando o fluxo precisar explicitar contexto multi-tenant.
- Hooks de Trading leem o estado de bootstrap em vez de assumir disponibilidade imediata do backend.

### Backend

- `GET /api/integrations/trading/status` responde mesmo sem contexto completo de tenant, mas marca `requiresTenant` quando necessario.
- O payload de `status` injeta a feature flag canonica `tradingWorkspaceV2Enabled`.
- Rotas de dados e execucao continuam protegidas por auth e permissao.

## Resultado esperado

- Sem queries prematuras antes da autenticacao.
- Sem tentativa de abrir WebSocket antes do bootstrap minimo.
- Sem divergencia entre Trading Real e Demo na ordem de inicializacao.
- Sem dependencia de historico de incidente para compreender o fluxo vigente.

## Referencias

- [domain-map.md](domain-map.md)
- [../product/workspace-shell.md](../product/workspace-shell.md)
- [../runbooks/operacao-testes.md](../runbooks/operacao-testes.md)
