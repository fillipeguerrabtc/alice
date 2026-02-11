# Runbook - Contaminação de Escopo (Training/LoRA)

**Autor:** Fillipe Guerra  
**Data:** 11 de Fevereiro de 2026  
**Objetivo:** diagnosticar e corrigir incidentes de vazamento/comportamento cruzado entre namespaces/agentes.

---

## 1) Sinais de incidente

- Respostas de um agente usando conhecimento de outro domínio/namespace.
- Queda abrupta de precisão após ativação de adapter recente.
- Aumento de overrides manuais ou itens em quarentena no Training.
- Logs de policy strict com adapter ausente para escopo ativo.

---

## 2) Diagnóstico rápido

## 2.1 Verificar adapter ativo por escopo

```bash
curl -s "http://alice-training:3004/api/training/lora/active?tenantId=<TENANT>&namespaceId=<NAMESPACE>&agentId=<AGENT>" \
  -H "X-Internal-Api-Secret: $INTERNAL_API_SECRET"
```

## 2.2 Verificar métricas de governança

- `alice_training_scope_quarantine_total{source_type,reason}`
- `alice_training_scope_override_total{source}`
- `alice_training_scope_resolved_total{source}`
- `alice_lora_resolve_total{result}`
- `alice_chat_lora_resolve_total{result}`

## 2.3 Verificar trilha de override

Consultar tabela `training_scope_overrides` para confirmar:
- quem alterou escopo (`changedBy`)
- de/para (`oldNamespaceId/newNamespaceId`, `oldAgentId/newAgentId`, `oldDomain/newDomain`)
- motivo (`reason`)
- origem (`source`)

---

## 3) Contenção imediata

- Desativar adapter suspeito no escopo afetado (namespace/agent).
- Manter política estrita habilitada em produção (`LORA_STRICT_BINDING=true`).
- Bloquear aprovação de itens ambíguos até resolver quarentena manualmente.

---

## 4) Correção estruturada

1. Revisar itens recentes aprovados no escopo afetado.
2. Reclassificar itens incorretos via resolução de escopo (`/api/training/data/:id/resolve-scope`).
3. Reprocessar job LoRA somente com dados do escopo correto.
4. Reativar adapter por escopo após validação de consistência.

---

## 5) Critérios de saída do incidente

- Sem novos eventos de contaminação por 24h.
- Quarentena estabilizada (sem crescimento anômalo).
- Taxa de fallback/base model dentro do esperado para escopos com adapter ativo.
- Validação funcional em chat + trading + post-mortem para o escopo corrigido.

---

## 6) Pós-incidente

- Registrar causa raiz e ações preventivas.
- Atualizar perfil de seleção semântica (`training_dataset_profiles`) se necessário.
- Revisar regras operacionais da equipe para uso de override.
