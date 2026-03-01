# Relatório de Implementação - Correção de Qualidade do Chat (LLM Runtime)

**Autor:** Fillipe Guerra  
**Data:** 01 de Março de 2026

## Contexto

Foi investigado em produção o problema de respostas corrompidas no chat (texto com mistura de idiomas, repetições e construção gramatical inválida), conforme evidências de interface e histórico persistido.

## Diagnóstico (Causa Raiz)

Após análise direta no servidor de produção, a causa raiz identificada foi **configuração efetiva incorreta do runtime do LLM** no container `gpu-llm`, com dois fatores principais:

1. **Precedência incorreta de variáveis de ambiente no entrypoint**
   - O script `docker/gpu/llm-qwen25/entrypoint.sh` priorizava variáveis legadas (`MAX_*`, `GPU_MEMORY_UTILIZATION`, `KV_CACHE_DTYPE`) antes das variáveis namespaced (`LLM_*`).
   - Em produção coexistiam ambos os conjuntos de variáveis; isso fazia o runtime usar valores legados não desejados.

2. **KV cache configurado com `fp8` por default**
   - O runtime emitia alerta de possível perda de acurácia com `fp8` sem scaling factor apropriado.
   - Esse cenário aumenta risco de degradação de qualidade textual em geração.

## Evidências Coletadas em Produção

- Mensagens do assistente já persistiam corrompidas no PostgreSQL (não era apenas problema visual).
- Requisições diretas ao `gpu-llm` (`/v1/chat/completions`) também retornavam texto corrompido.
- Serviços `chat`, `llm-gateway` e `gpu-manager` estavam saudáveis, reforçando que o problema estava no runtime/model serving.
- Logs do `gpu-llm` mostravam uso de parâmetros efetivos vindos de variáveis legadas.

## Implementação (Mudanças Cirúrgicas)

### 1) `docker/gpu/llm-qwen25/entrypoint.sh`

- Ajustada a precedência para priorizar `LLM_*` e usar legadas apenas como fallback.
- Alterado default de `KV cache dtype` para `auto`.
- Adicionados avisos explícitos quando variável legada é usada como fonte (`WARN` de depreciação).

### 2) `infra/docker/stacks/docker-compose.alice.yml`

- Alterado default de `LLM_KV_CACHE_DTYPE` de `fp8` para `auto`.

### 3) `infra/docker/.env.prod.example`

- Alterado `LLM_KV_CACHE_DTYPE=fp8` para `LLM_KV_CACHE_DTYPE=auto`.

## Resultado Esperado

- Runtime do LLM passa a respeitar configurações namespaced planejadas para produção.
- Redução da chance de degradação de qualidade por configuração agressiva de KV cache.
- Maior previsibilidade operacional com aviso explícito quando variáveis legadas ainda estiverem ativas.

## Observações Operacionais

- Não houve alteração de triggers/workflows de CI/CD.
- Não foram introduzidos mocks, stubs, placeholders ou hardcoded de comportamento de negócio.
- Mudanças focadas exclusivamente em configuração/entrypoint do serviço LLM.
