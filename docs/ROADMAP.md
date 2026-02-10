# Roadmap — Funcionalidades Futuras

**Autor:** Fillipe Guerra  
**Data:** 10 de Fevereiro de 2026

---

## Trading — KuCoin

### Margin: Borrow/Repay
- Implementar endpoints de empréstimo e pagamento para operações Margin.
- Ref: KuCoin Margin Borrow/Repay API.

### Credenciais por Tenant
- Atualmente credenciais KuCoin vêm de variáveis de ambiente (single-tenant).
- Se multi-tenant real: persistir credenciais por tenant com criptografia e chaveamento seguro.
- Se single-tenant permanente: remover campos de credenciais do schema `trading_risk_config` para evitar inconsistência.

### Módulos KuCoin Adicionais
- **Transfers**: Transferências internas entre contas (Main, Trading, Margin, Futures).
- **Sub-accounts**: Gestão de sub-contas para isolamento de risco.
- **Fees**: Consulta de taxas por par/mercado.
- **Deposits/Withdrawals**: Depósitos e saques de criptomoedas.

---

## Observações
- Todos os gaps e bugs identificados na auditoria de Trading KuCoin (P0, P1, P2) foram corrigidos.
- A plataforma cobre Futures + Spot + Margin com WebSocket unificado (`kucoinUnifiedWebSocket.ts`) e REST multi-mercado.
- Os itens acima são funcionalidades de **expansão futura**, não correções pendentes.
