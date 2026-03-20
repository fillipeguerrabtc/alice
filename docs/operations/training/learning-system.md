# Sistema de Aprendizado da Alice

**Author:** Fillipe Guerra
**Data:** 18 de Marco de 2026
**Atualizado:** 20 de Marco de 2026
**Status:** ativo
**Tipo:** ssot

## Objetivo

Explicar como a Alice aprende hoje, separando claramente conhecimento recuperavel, dados de comportamento, governanca de coleta e execucao de treino.

## Principios

- `RAG` serve para fatos e conteudo mutavel.
- `Training` serve para comportamento, formato de resposta e especializacao por escopo.
- `Namespace` e o boundary principal de isolamento para coleta, busca, aprovacao e ativacao de adapter.
- Coleta so pode promover conteudo que o ator podia acessar no momento da captura, com snapshot de ownership e grants.
- O fluxo oficial trabalha com integracoes reais, sem mocks, sem bypass direto e sem dataset montado ad hoc fora do pipeline canonico.

## Quando usar cada mecanismo

| Necessidade | Mecanismo principal | Documento |
| --- | --- | --- |
| Atualizar playbooks, politicas e manuais | `RAG` | [../../product/training-business-guide.md](../../product/training-business-guide.md) |
| Ensinar estilo, tomada de decisao e formato de resposta | `Training` | [overview.md](overview.md) |
| Coletar dados automaticamente com consentimento e policy gate | `Auto-collect` | [auto-collect-governance.md](auto-collect-governance.md) |
| Ajustar limites e gates tecnicos | `System Config` + treino | [reference-limits.md](reference-limits.md) |

## Fontes canonicas de entrada

| Fonte | Entrada oficial | Destino inicial | Observacoes |
| --- | --- | --- | --- |
| Chat | `POST /api/chat/conversations/:id/training/collect` e fluxos de coleta aprovados | `training_data` | conversas longas podem ser fatiadas em janelas |
| Canais externos | integracoes que chamam `POST /api/training/data` | `training_data` | segue o mesmo policy gate do restante do pipeline |
| Documentos e midia RAG | ingestao em `alice-rag` e envio controlado para treino | `training_data` com segregacao por `purpose` | conhecimento recuperavel nao vira SFT por default |
| Importacao em lote | `POST /api/training/bulk-import` | `training_data` | continua sujeita a escopo, policy gate e dedupe |
| Exemplos aprovados de dominios especializados | aprovacoes feitas na UI/servicos oficiais | `training_data` | reutiliza a mesma trilha de dataset versionado |

## Fluxo canonico do aprendizado

### 1. Coleta e normalizacao

- O sistema persiste candidatos em `training_data`.
- As entradas carregam contexto suficiente para auditoria: fonte, escopo, metadados e lineage.
- Ownership, grants e permissao efetiva da coleta passam a compor o snapshot persistido do item.
- Conversas, documentos e midias usam o mesmo pipeline de governanca, sem rotas paralelas para bypass.

### 2. Resolucao de escopo

- O `scope-resolver` tenta resolver `namespaceId`, `agentId` e `domain`.
- A ordem pratica de resolucao passa por input direto, relacionamento de conversa, relacionamento por origem, inferencia semantica e fallback por `sourceType`.
- Quando o escopo nao e seguro, o item entra em revisao humana e pode receber `suggestedNewNamespace`.
- A correcao manual reutiliza `PATCH /api/training/data/:id/resolve-scope`.

### 3. Policy gate, qualidade e quarentena

- Consentimento, privacidade, qualidade minima e deduplicacao rodam antes da liberacao para treino.
- Itens com baixa confianca, profile ausente ou match de regra sensivel ficam em quarentena.
- Conteudo privado de outro usuario permanece bloqueado sem grant explicito, inclusive para operadores administrativos do tenant.
- O sistema opera em modo restritivo quando Redis ou configuracao de profile nao sustentam a governanca esperada.

### 4. Dataset versionado

- `planCanonicalDatasetSelection(...)` e a entrada unica para montar dataset.
- `persistCanonicalDatasetSnapshot(...)` gera manifesto imutavel em `training_dataset_versions`.
- `lora_jobs.dataset_version_id` referencia esse snapshot, evitando reconstrucao posterior do dataset.
- O lifecycle de reserva e uso de linhas continua acoplado ao `jobId`.

### 5. Execucao de treino

- A criacao de job acontece por `POST /api/training/jobs`.
- O handler cria os registros e enfileira o trabalho; o processamento pesado nao roda no request HTTP.
- O `training-service` usa o orquestrador para `prepare-training` e `restore-serving`, diretamente ou pelo proxy em `/api/training/gpu-orchestrator/*`.
- O estado de runtime continua governado pelo `gpu-manager`.

### 6. Ativacao por escopo

- A ativacao continua apoiada em `lora_jobs.is_active_by_scope`.
- O lookup do adapter ativo usa `GET /api/training/lora/active`.
- Quando nao ha adapter valido, o runtime volta para o modelo base canonico, sem promover dados fora de governanca.

## O que este documento nao cobre

- Hyperparams, defaults e thresholds detalhados: [reference-limits.md](reference-limits.md).
- Sampling, caps diarios, consentimento e policy gate em profundidade: [auto-collect-governance.md](auto-collect-governance.md).
- Procedimento operacional de validacao em GPU: [../runbooks/training-gpu-validation.md](../runbooks/training-gpu-validation.md).
- Historico cumulativo de rollout: [../../archive/plans/codex-enterprise-execution.md](../../archive/plans/codex-enterprise-execution.md).

## Referencias

- [overview.md](overview.md)
- [reference-limits.md](reference-limits.md)
- [auto-collect-governance.md](auto-collect-governance.md)
- [../../architecture/content-segregation.md](../../architecture/content-segregation.md)
- [../../architecture/gpu-manager.md](../../architecture/gpu-manager.md)
- [../../product/training-business-guide.md](../../product/training-business-guide.md)
