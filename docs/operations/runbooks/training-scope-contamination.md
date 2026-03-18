# Runbook de Contaminacao de Escopo

**Author:** Fillipe Guerra
**Data:** 18 de Marco de 2026
**Atualizado:** 18 de Marco de 2026

## Objetivo

Diagnosticar e conter vazamento de contexto entre namespaces, agentes e adapters no fluxo de training/LoRA.

## Sinais de incidente

- respostas de um escopo usando conhecimento de outro
- queda brusca de precisao apos ativacao de adapter recente
- aumento de overrides manuais ou quarentena
- logs de politica estrita com adapter ausente para o escopo ativo

## Diagnostico rapido

### Adapter ativo por escopo

```bash
curl -s "http://alice-training:3004/api/training/lora/active?tenantId=<TENANT>&namespaceId=<NAMESPACE>&agentId=<AGENT>" \
  -H "X-Internal-Api-Secret: $INTERNAL_API_SECRET"
```

### Metricas a conferir

- `alice_training_scope_quarantine_total{source_type,reason}`
- `alice_training_scope_override_total{source}`
- `alice_training_scope_resolved_total{source}`
- `alice_lora_resolve_total{result}`
- `alice_chat_lora_resolve_total{result}`

### Trilha de override

Validar em `training_scope_overrides`:

- `changedBy`
- `oldNamespaceId` e `newNamespaceId`
- `oldAgentId` e `newAgentId`
- `oldDomain` e `newDomain`
- `reason`
- `source`

## Contencao imediata

1. desativar o adapter suspeito no escopo afetado
2. manter `LORA_STRICT_BINDING=true`
3. bloquear aprovacoes ambiguas ate resolver a quarentena

## Correcao estrutural

1. revisar itens aprovados recentemente no escopo afetado
2. reclassificar itens incorretos via resolucao de escopo
3. reprocessar o job LoRA somente com dados do escopo correto
4. reativar o adapter apenas apos validacao funcional

## Criterio de saida

- nenhum novo evento por 24h
- quarentena estabilizada
- fallback para base model em patamar esperado
- validacao funcional concluida para o escopo corrigido

## Pos-incidente

- registrar causa raiz e acao preventiva
- revisar `training_dataset_profiles` se necessario
- ajustar regra operacional da equipe sem transformar o runbook em historico cronologico

## Referencias

- [../../architecture/gpu-manager.md](../../architecture/gpu-manager.md)
- [../observability.md](../observability.md)
