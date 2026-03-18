# Guia de Treinamento de Agentes da Alice

**Author:** Fillipe Guerra
**Data:** 18 de Marco de 2026
**Atualizado:** 18 de Marco de 2026
**Status:** ativo
**Tipo:** ssot

## Objetivo

Explicar, em linguagem de uso real, como negocio deve alimentar conhecimento e comportamento dos agentes sem misturar o guia com detalhes de infra, pipeline ou runbook tecnico.

## Regra simples

- `RAG` = fatos, playbooks, politicas e conteudo que muda.
- `Training` = comportamento, estilo, formato de resposta e especializacao do agente.

## Fluxo recomendado de uso

### 1. Separar o dominio

- Criar ou escolher o `namespace` correto.
- Garantir que o agente certo esta vinculado a esse contexto.
- Nao misturar conteudo de dominios diferentes no mesmo namespace.

### 2. Alimentar conhecimento pelo RAG

- Subir documentos, manuais e playbooks que precisam ficar consultaveis.
- Usar `RAG` para regras e fatos que mudam com frequencia.
- Validar no chat se o agente recupera o conteudo esperado antes de pensar em fine-tuning.

### 3. Coletar comportamento de alta qualidade

- Aprovar apenas conversas, sinais e exemplos que representam o padrao ideal do agente.
- Reprovar respostas vagas, inseguras ou com contexto incompleto.
- Tratar exemplos repetidos ou ruidosos como passivo de qualidade, nao como volume util.

### 4. Revisar o material antes do treino

- Confirmar escopo correto de `namespace`, `agent` e `domain`.
- Verificar se o dado precisa mesmo virar `Training` ou se deveria ficar apenas no `RAG`.
- Evitar promover dados sensiveis ou ambiguidade de contexto sem revisao humana.

### 5. Treinar e validar

- Criar o job pelo fluxo oficial de `Training`.
- Validar o comportamento do adapter no escopo correto antes de promover.
- Manter rollback e promocao como decisoes controladas, nunca automaticas por conveniencia.

## Quando usar RAG e quando usar Training

| Situacao | Melhor caminho |
| --- | --- |
| Politica, procedimento, regra ou playbook que muda | `RAG` |
| Estilo de resposta, tom, formato e criterio de decisao | `Training` |
| Conhecimento geral que precisa ser consultado sem retreinar | `RAG` |
| Ajuste fino de agente especializado por namespace | `Training` |

## O que evitar

- Usar `Training` para corrigir fato que deveria estar em documento.
- Misturar exemplos de dominios diferentes no mesmo escopo.
- Aprovar volume alto de exemplos medianos so para bater minimo de dataset.
- Tratar historico de rodadas como instrucao operacional atual.

## Se precisar de detalhe tecnico

- Panorama tecnico: [../operations/training/overview.md](../operations/training/overview.md)
- Modelo de aprendizado: [../operations/training/learning-system.md](../operations/training/learning-system.md)
- Limites e configuracoes: [../operations/training/reference-limits.md](../operations/training/reference-limits.md)
- Governanca de auto-collect: [../operations/training/auto-collect-governance.md](../operations/training/auto-collect-governance.md)
