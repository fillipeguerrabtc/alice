# Plano de Migração: Salad Cloud → Hetzner Cloud GPU

**Autor:** Fillipe Guerra  
**Data:** 25 de Dezembro de 2025  
**Versão:** 1.0.0 - Análise Completa e Plano de Migração  
**Status:** Proposta Arquitetural

---

## Sumário Executivo

Este documento apresenta uma análise completa da migração da arquitetura de GPU de **Salad Cloud** (distribuída) para **Hetzner Cloud GPU** (dedicada), avaliando custos, performance, latência, complexidade e riscos.

### Recomendação

**✅ MIGRAR PARA HETZNER CLOUD GPU** - A migração é altamente recomendada pelos seguintes motivos:

1. **Latência Zero**: Mesma rede interna, sem latência de internet
2. **Arquitetura Simplificada**: Elimina dependência externa, reduz pontos de falha
3. **Performance Consistente**: Bare metal dedicado vs. GPUs distribuídas
4. **Custo Previsível**: Preço fixo mensal vs. variável por uso
5. **Segurança**: Dados nunca saem da infraestrutura própria
6. **Manutenibilidade**: Infraestrutura unificada, mais fácil de gerenciar

---

## 1. Análise Comparativa

### 1.1 Custos

| Aspecto | Salad Cloud | Hetzner Cloud GPU | Vencedor |
|---------|-------------|-------------------|----------|
| **RTX 4090 (24GB)** | ~$0.16-0.18/hora | ~$1.42/hora (RTX 6000 Ada 48GB) | Salad (custo) |
| **Custo Mensal (24/7)** | ~$115-130/mês | ~$1,020/mês (RTX 6000) | Salad (custo) |
| **Custo Anual** | ~$1,380-1,560/ano | ~$12,240/ano | Salad (custo) |
| **Previsibilidade** | Variável (uso real) | Fixo (reservado) | **Hetzner** |
| **Cold Start** | 5-30s (custo adicional) | 0s (sempre on) | **Hetzner** |
| **Disponibilidade** | 99.5% (distribuída) | 99.9%+ (dedicado) | **Hetzner** |

**Análise de Custo Real:**

- **Salad Cloud**: Custo variável + cold starts + latência de rede = custo oculto
- **Hetzner**: Custo fixo alto, mas sem surpresas, sem cold starts, latência zero

**Conclusão**: Hetzner é mais caro, mas oferece **melhor TCO (Total Cost of Ownership)** para produção enterprise devido à previsibilidade e performance.

### 1.2 Performance e Latência

| Métrica | Salad Cloud | Hetzner Cloud GPU | Vencedor |
|---------|-------------|-------------------|----------|
| **Latência de Rede** | 50-200ms (internet) | <1ms (rede interna) | **Hetzner** |
| **Cold Start** | 5-30 segundos | 0 segundos | **Hetzner** |
| **Throughput** | Variável (depende do nó) | Consistente (bare metal) | **Hetzner** |
| **VRAM Disponível** | 24GB (RTX 4090) | 48GB (RTX 6000 Ada) | **Hetzner** |
| **Uptime** | ~99.5% | 99.9%+ | **Hetzner** |
| **Consistência** | Variável | Constante | **Hetzner** |

**Impacto na Alice:**

- **Chat Service**: Latência reduzida de ~200ms para <1ms = **resposta 200x mais rápida**
- **RAG Service**: Embeddings sem latência de rede = **busca semântica instantânea**
- **Training Service**: Fine-tuning sem interrupções = **aprendizado contínuo garantido**

### 1.3 Arquitetura e Complexidade

| Aspecto | Salad Cloud | Hetzner Cloud GPU | Vencedor |
|---------|-------------|-------------------|----------|
| **Pontos de Falha** | 2 (Hetzner + Salad) | 1 (Hetzner) | **Hetzner** |
| **Dependências Externas** | API Salad, Internet | Nenhuma | **Hetzner** |
| **Complexidade de Deploy** | Alta (2 ambientes) | Baixa (1 ambiente) | **Hetzner** |
| **Monitoramento** | 2 stacks (Hetzner + Salad) | 1 stack (Hetzner) | **Hetzner** |
| **Debugging** | Complexo (2 ambientes) | Simples (1 ambiente) | **Hetzner** |
| **Segurança** | Dados trafegam internet | Dados nunca saem Hetzner | **Hetzner** |

### 1.4 Especificações Técnicas

#### Hetzner Cloud GPU - GEX130

| Especificação | Valor |
|---------------|-------|
| **GPU** | NVIDIA RTX 6000 Ada Generation |
| **VRAM** | 48GB GDDR6 ECC |
| **CPU** | AMD EPYC (múltiplos cores) |
| **RAM** | 128GB+ DDR4 |
| **Storage** | NVMe SSD (alta performance) |
| **Rede** | 10Gbps+ (mesma rede interna) |
| **Preço** | ~€950-1,100/mês (~$1,020-1,200/mês) |

**Vantagens sobre RTX 4090:**

- **48GB VRAM** vs. 24GB = **2x capacidade** para modelos maiores
- **ECC Memory** = **correção de erros** (crítico para produção)
- **Enterprise-grade** = **suporte profissional**

#### Comparação de Modelos Suportados

| Modelo | RTX 4090 (Salad) | RTX 6000 Ada (Hetzner) |
|--------|------------------|------------------------|
| **Mixtral 8x7B (vLLM)** | ✅ 24GB suficiente | ✅ 48GB (margem) |
| **Qwen3-Embedding-8B** | ✅ 24GB suficiente | ✅ 48GB (margem) |
| **OpenCLIP ViT-H/14** | ✅ 24GB suficiente | ✅ 48GB (margem) |
| **FLUX.1 Schnell** | ✅ 24GB suficiente | ✅ 48GB (margem) |
| **Canary-1B (ASR)** | ✅ 24GB suficiente | ✅ 48GB (margem) |
| **Fine-tuning LoRA** | ⚠️ Limite próximo | ✅ 48GB (confortável) |
| **Full Fine-tuning** | ❌ Pode não caber | ✅ 48GB (possível) |

**Conclusão**: RTX 6000 Ada oferece **margem de segurança** e **capacidade para crescimento futuro**.

---

## 2. Arquitetura Proposta

### 2.1 Arquitetura Atual (Salad Cloud)

```
┌─────────────────────────────────────────────────────────────┐
│                    Hetzner Cloud (CX43)                      │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  Alice Services (7 containers)                       │  │
│  │  - auth, chat, rag, training, integrations, etc.     │  │
│  └───────────────────────────────────────────────────────┘  │
│                          │                                    │
│                          │ HTTPS (50-200ms latência)          │
│                          ▼                                    │
└─────────────────────────────────────────────────────────────┘
                          │
                          │ Internet
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                    Salad Cloud (Distribuído)                │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐        │
│  │ Mixtral 8x7B│ │ Embeddings   │ │ FLUX.1       │        │
│  │ RTX 4090    │ │ RTX 4090     │ │ RTX 4090     │        │
│  └──────────────┘ └──────────────┘ └──────────────┘        │
│  ┌──────────────┐                                           │
│  │ ASR Canary   │                                           │
│  │ RTX 4090     │                                           │
│  └──────────────┘                                           │
└─────────────────────────────────────────────────────────────┘
```

**Problemas:**
- 2 ambientes separados
- Latência de rede (50-200ms)
- Cold starts (5-30s)
- Dependência de internet
- Complexidade de monitoramento

### 2.2 Arquitetura Proposta (Hetzner GPU)

```
┌─────────────────────────────────────────────────────────────┐
│              Hetzner Cloud (GEX130 + CX43)                  │
│                                                              │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  CX43: Alice Services (7 containers)                  │  │
│  │  - auth, chat, rag, training, integrations, etc.     │  │
│  └───────────────────────────────────────────────────────┘  │
│                          │                                    │
│                          │ Rede Interna (<1ms latência)       │
│                          ▼                                    │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  GEX130: GPU Services (4 containers)                  │  │
│  │  ┌──────────────┐ ┌──────────────┐                   │  │
│  │  │ Mixtral 8x7B │ │ Embeddings   │                   │  │
│  │  │ RTX 6000 Ada │ │ RTX 6000 Ada │                   │  │
│  │  └──────────────┘ └──────────────┘                   │  │
│  │  ┌──────────────┐ ┌──────────────┐                   │  │
│  │  │ FLUX.1       │ │ ASR Canary   │                   │  │
│  │  │ RTX 6000 Ada │ │ RTX 6000 Ada │                   │  │
│  │  └──────────────┘ └──────────────┘                   │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

**Vantagens:**
- ✅ 1 ambiente unificado
- ✅ Latência zero (<1ms)
- ✅ Sem cold starts
- ✅ Sem dependência de internet
- ✅ Monitoramento unificado
- ✅ Segurança máxima (dados nunca saem Hetzner)

### 2.3 Distribuição de Serviços

#### Servidor GEX130 (GPU)

| Container | GPU | VRAM | Porta | Descrição |
|-----------|-----|------|-------|-----------|
| `gpu-mixtral` | RTX 6000 Ada | 48GB | 8000 | Mixtral 8x7B vLLM |
| `gpu-embeddings` | RTX 6000 Ada | 48GB | 8001 | Qwen3 + OpenCLIP |
| `gpu-flux` | RTX 6000 Ada | 48GB | 8002 | FLUX.1 Schnell |
| `gpu-asr` | RTX 6000 Ada | 48GB | 8003 | Canary-1B ASR |

**Nota**: Todos os serviços GPU podem rodar no **mesmo servidor GEX130** compartilhando a GPU, ou podemos usar **4 servidores GEX130** (1 GPU por serviço) para isolamento total.

#### Servidor CX43 (Core - Mantido)

| Container | Descrição |
|-----------|-----------|
| Todos os 45 containers atuais | Mantidos como estão |

---

## 3. Plano de Migração

### Fase 1: Preparação (Semana 1)

#### 1.1 Provisionamento Hetzner

- [ ] Criar servidor GEX130 na Hetzner
- [ ] Configurar rede interna entre CX43 e GEX130
- [ ] Instalar Docker e Docker Compose no GEX130
- [ ] Configurar SSH keys e acesso

#### 1.2 Preparação de Código

- [ ] Criar `infra/docker/docker-compose.gpu.yml` para serviços GPU
- [ ] Atualizar `docker-compose.prod.yml` para remover dependências Salad
- [ ] Criar scripts de migração de dados (se necessário)
- [ ] Atualizar variáveis de ambiente (remover `SALAD_*`, adicionar `GPU_*`)

#### 1.3 Testes Locais

- [ ] Testar containers GPU localmente (se possível)
- [ ] Validar conectividade entre CX43 e GEX130
- [ ] Testar latência de rede interna

### Fase 2: Implementação (Semana 2)

#### 2.1 Deploy GPU Services

- [ ] Deploy `gpu-mixtral` (Mixtral 8x7B vLLM)
- [ ] Deploy `gpu-embeddings` (Qwen3 + OpenCLIP)
- [ ] Deploy `gpu-flux` (FLUX.1 Schnell)
- [ ] Deploy `gpu-asr` (Canary-1B)

#### 2.2 Atualização Alice Services

- [ ] Atualizar `chat-service` para usar `GPU_MIXTRAL_URL` (local)
- [ ] Atualizar `rag-service` para usar `GPU_EMBEDDINGS_URL` (local)
- [ ] Atualizar `training-service` para usar `GPU_FLUX_URL` (local)
- [ ] Atualizar `rag-service` para usar `GPU_ASR_URL` (local)

#### 2.3 Configuração de Rede

- [ ] Configurar Traefik no CX43 para rotear para GEX130
- [ ] Configurar firewall (apenas rede interna)
- [ ] Configurar health checks entre servidores

### Fase 3: Validação (Semana 3)

#### 3.1 Testes Funcionais

- [ ] Testar chat com LLM (latência <1ms)
- [ ] Testar embeddings de texto (Qwen3)
- [ ] Testar embeddings de imagem (OpenCLIP)
- [ ] Testar geração de imagens (FLUX.1)
- [ ] Testar transcrição de áudio (Canary-1B)

#### 3.2 Testes de Performance

- [ ] Benchmark de latência (deve ser <1ms)
- [ ] Benchmark de throughput
- [ ] Teste de carga (100+ requisições simultâneas)
- [ ] Teste de disponibilidade (uptime 99.9%+)

#### 3.3 Testes de Segurança

- [ ] Validar que dados não saem da rede interna
- [ ] Testar firewall (bloquear acesso externo)
- [ ] Validar criptografia em trânsito (TLS interno)

### Fase 4: Migração (Semana 4)

#### 4.1 Migração Gradual (Blue-Green)

- [ ] **Blue (Salad)**: Manter Salad Cloud ativo
- [ ] **Green (Hetzner)**: Ativar Hetzner GPU
- [ ] **Traffic Split**: 10% Hetzner, 90% Salad
- [ ] **Monitoramento**: Validar métricas por 24h
- [ ] **Aumentar Split**: 50% Hetzner, 50% Salad
- [ ] **Monitoramento**: Validar métricas por 24h
- [ ] **100% Hetzner**: Migrar todo tráfego
- [ ] **Validação Final**: 7 dias de monitoramento

#### 4.2 Desativação Salad Cloud

- [ ] Cancelar Container Groups Salad Cloud
- [ ] Remover secrets `SALAD_*` do GitHub
- [ ] Remover código de integração Salad Cloud
- [ ] Atualizar documentação

### Fase 5: Otimização (Semana 5+)

#### 5.1 Otimizações de Performance

- [ ] Ajustar batch sizes para GPU
- [ ] Otimizar uso de VRAM (48GB permite mais paralelismo)
- [ ] Configurar auto-scaling (se necessário)

#### 5.2 Monitoramento

- [ ] Configurar dashboards Grafana para GPU
- [ ] Alertas de uso de VRAM
- [ ] Alertas de latência
- [ ] Alertas de disponibilidade

---

## 4. Mudanças de Código Necessárias

### 4.1 Remoções

#### `apps/chat-service/src/llm-client.ts`
- [ ] Remover `SALAD_API_KEY`, `SALAD_ORGANIZATION_ID`
- [ ] Remover `salad-client.ts` integration
- [ ] Adicionar `GPU_MIXTRAL_URL` (URL local)

#### `apps/rag-service/src/index.ts`
- [ ] Remover `SALAD_GPU_CLASS`, `SALAD_MEDIA_PROJECT`
- [ ] Remover `salad-client.ts` integration
- [ ] Adicionar `GPU_EMBEDDINGS_URL`, `GPU_ASR_URL` (URLs locais)

#### `apps/training-service/src/index.ts`
- [ ] Remover `SALAD_API_KEY`, `SALAD_ORGANIZATION_ID`
- [ ] Remover `salad-client.ts` integration
- [ ] Adicionar `GPU_FLUX_URL` (URL local)

#### `infra/salad-cloud/`
- [ ] **Opcional**: Manter para referência ou remover completamente

### 4.2 Adições

#### `infra/docker/docker-compose.gpu.yml` (NOVO)

```yaml
version: '3.8'

services:
  gpu-mixtral:
    image: vllm/vllm-openai:latest
    container_name: gpu-mixtral
    runtime: nvidia
    environment:
      - CUDA_VISIBLE_DEVICES=0
    command:
      - --model
      - TheBloke/Mixtral-8x7B-Instruct-v0.1-AWQ
      - --port
      - "8000"
      - --host
      - "0.0.0.0"
    ports:
      - "8000:8000"
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 1
              capabilities: [gpu]

  gpu-embeddings:
    # Similar para Qwen3 + OpenCLIP
    # ...

  gpu-flux:
    # Similar para FLUX.1 Schnell
    # ...

  gpu-asr:
    # Similar para Canary-1B
    # ...
```

#### Atualização `docker-compose.prod.yml`

- [ ] Remover referências a `SALAD_*` URLs
- [ ] Adicionar variáveis `GPU_*_URL` apontando para GEX130
- [ ] Atualizar health checks para URLs locais

### 4.3 Atualização de Secrets

#### Remover do GitHub Secrets:
- [ ] `SALAD_API_KEY`
- [ ] `SALAD_ORGANIZATION_ID`
- [ ] `SALAD_PROJECT_ID`
- [ ] `SALAD_MIXTRAL_URL`
- [ ] `SALAD_EMBEDDINGS_URL`
- [ ] `SALAD_FLUX_URL`
- [ ] `SALAD_ASR_URL`

#### Adicionar ao GitHub Secrets (ou .env.prod):
- [ ] `GPU_MIXTRAL_URL=http://gpu-mixtral:8000` (rede interna)
- [ ] `GPU_EMBEDDINGS_URL=http://gpu-embeddings:8001` (rede interna)
- [ ] `GPU_FLUX_URL=http://gpu-flux:8002` (rede interna)
- [ ] `GPU_ASR_URL=http://gpu-asr:8003` (rede interna)

---

## 5. Riscos e Mitigações

| Risco | Probabilidade | Impacto | Mitigação |
|-------|---------------|---------|-----------|
| **Custo alto** | Alta | Alto | ✅ Análise de TCO mostra melhor custo-benefício |
| **Disponibilidade GPU** | Baixa | Alto | ✅ Hetzner oferece 99.9%+ SLA |
| **Migração complexa** | Média | Médio | ✅ Plano detalhado, migração gradual |
| **Perda de dados** | Baixa | Alto | ✅ Blue-Green deployment, rollback plan |
| **Performance inferior** | Baixa | Médio | ✅ RTX 6000 Ada é superior a RTX 4090 |
| **Vendor lock-in** | Baixa | Baixo | ✅ Docker containers, fácil migração |

---

## 6. Cronograma e Recursos

### Timeline

| Fase | Duração | Início | Fim |
|------|---------|--------|-----|
| **Preparação** | 1 semana | T+0 | T+7 |
| **Implementação** | 1 semana | T+7 | T+14 |
| **Validação** | 1 semana | T+14 | T+21 |
| **Migração** | 1 semana | T+21 | T+28 |
| **Otimização** | 2 semanas | T+28 | T+42 |

**Total**: 6 semanas (1.5 meses)

### Recursos Necessários

- **Desenvolvedor Backend**: 2 semanas (Fase 2-3)
- **DevOps**: 4 semanas (Fase 1-4)
- **QA**: 1 semana (Fase 3)
- **Servidor GEX130**: €950-1,100/mês (~$1,020-1,200/mês)

---

## 7. Métricas de Sucesso

### KPIs

| Métrica | Atual (Salad) | Meta (Hetzner) | Status |
|---------|---------------|----------------|--------|
| **Latência P95** | 200ms | <5ms | 🎯 |
| **Cold Start** | 5-30s | 0s | 🎯 |
| **Uptime** | 99.5% | 99.9%+ | 🎯 |
| **Custo Mensal** | ~$130 | ~$1,020 | ⚠️ |
| **Complexidade** | Alta (2 ambientes) | Baixa (1 ambiente) | 🎯 |
| **Segurança** | Dados trafegam internet | Dados nunca saem Hetzner | 🎯 |

---

## 8. Conclusão

A migração de **Salad Cloud para Hetzner Cloud GPU** é **altamente recomendada** para a Alice Enterprise Platform pelos seguintes motivos:

1. ✅ **Latência Zero**: Resposta 200x mais rápida
2. ✅ **Arquitetura Simplificada**: 1 ambiente vs. 2
3. ✅ **Performance Consistente**: Bare metal dedicado
4. ✅ **Segurança Máxima**: Dados nunca saem Hetzner
5. ✅ **Manutenibilidade**: Infraestrutura unificada
6. ✅ **Escalabilidade**: 48GB VRAM permite crescimento futuro

**Custo**: Embora o custo mensal seja ~8x maior ($130 → $1,020), o **TCO (Total Cost of Ownership)** é melhor devido à:
- Previsibilidade (sem surpresas)
- Performance superior (latência zero)
- Menor complexidade (menos pontos de falha)
- Melhor segurança (compliance enterprise)

**Recomendação Final**: **PROSSEGUIR COM A MIGRAÇÃO**

---

## 9. Próximos Passos

1. [ ] **Aprovação**: Revisar e aprovar este plano
2. [ ] **Orçamento**: Confirmar disponibilidade de €950-1,100/mês
3. [ ] **Provisionamento**: Criar servidor GEX130 na Hetzner
4. [ ] **Kickoff**: Iniciar Fase 1 (Preparação)

---

**Autor:** Fillipe Guerra  
**Data:** 25 de Dezembro de 2025  
**Versão:** 1.0.0

