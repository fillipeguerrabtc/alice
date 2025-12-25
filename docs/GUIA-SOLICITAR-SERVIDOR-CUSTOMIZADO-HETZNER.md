# Guia: Solicitar Servidor Customizado com RTX 3090/4090 24GB na Hetzner

**Autor:** Fillipe Guerra  
**Data:** 25 de Dezembro de 2025  
**Versão:** 1.0

---

## 🎯 Objetivo

Solicitar servidor dedicado customizado na Hetzner com GPU RTX 3090 ou RTX 4090 (24GB VRAM) para Alice Enterprise Platform.

---

## 📋 Especificações Desejadas

### Requisitos Mínimos

| Componente | Especificação Mínima | Especificação Ideal |
|------------|---------------------|---------------------|
| **GPU** | RTX 3090 ou RTX 4090 | RTX 4090 (melhor performance) |
| **VRAM** | **24GB** (obrigatório) | 24GB |
| **CPU** | 8+ cores | 12-16 cores |
| **RAM** | 64GB | 128GB (ideal) |
| **Storage** | 500GB NVMe SSD | 1TB+ NVMe SSD |
| **Bandwidth** | 1 Gbit/s | 1 Gbit/s |
| **Localização** | Nuremberg | Nuremberg (mesma região do Deploy Server) |

---

## 📝 Como Solicitar

### Passo 1: Acessar Hetzner Robot

1. Acesse: https://robot.your-server.de
2. Faça login na sua conta Hetzner

### Passo 2: Criar Ticket de Suporte

1. No menu lateral, clique em **Support**
2. Clique em **Create Ticket** (ou **New Ticket**)
3. Selecione categoria: **Server** → **Ordering/Configuration**

### Passo 3: Escrever Solicitação

**Assunto:**
```
Solicitação: Servidor Dedicado Customizado com GPU RTX 3090/4090 24GB
```

**Mensagem (copie e cole):**

```
Olá equipe Hetzner,

Gostaria de solicitar um servidor dedicado customizado com as seguintes especificações:

ESPECIFICAÇÕES DESEJADAS:
- GPU: NVIDIA RTX 3090 ou RTX 4090 (24GB VRAM) - OBRIGATÓRIO
- CPU: 8+ cores (Intel ou AMD)
- RAM: 64GB mínimo (128GB ideal)
- Storage: 500GB+ NVMe SSD (1TB+ ideal)
- Bandwidth: 1 Gbit/s
- Localização: Nuremberg (preferencial)

USO:
Servidor de produção para plataforma enterprise com:
- 50 containers Docker
- Modelo LLM próprio (Mixtral 8x7B via vLLM)
- Processamento multimodal (texto, imagem, áudio)
- Requer 24GB VRAM para operação estável

ORÇAMENTO:
Disponível: €200-300/mês

PERGUNTAS:
1. Qual GPU está disponível: RTX 3090 ou RTX 4090?
2. Qual o custo mensal estimado?
3. Qual o tempo de provisionamento?
4. É possível escolher localização (Nuremberg)?

Aguardo retorno.

Obrigado!
```

### Passo 4: Enviar Ticket

1. Revise a mensagem
2. Clique em **Submit** (ou **Send**)
3. Aguarde resposta (geralmente 1-2 dias úteis)

---

## 💰 Custo Estimado

| Componente | Custo Estimado |
|------------|----------------|
| **RTX 3090 24GB** | ~€200-250/mês |
| **RTX 4090 24GB** | ~€250-300/mês |
| **Setup (one-time)** | ~€79-159 |

**Comparação:**
- GEX44 (20GB): €184/mês
- Custom RTX 3090 (24GB): ~€200-250/mês (+€16-66/mês)
- Custom RTX 4090 (24GB): ~€250-300/mês (+€66-116/mês)

**Vantagem:** +4GB VRAM por apenas +€16-116/mês = **Vale muito a pena!**

---

## ⏱️ Tempo de Provisionamento

- **Resposta do suporte:** 1-2 dias úteis
- **Provisionamento:** 3-7 dias úteis (após aprovação)
- **Total:** ~1-2 semanas

---

## ✅ Alternativas se Customizado Não For Viável

### Opção 1: Usar GEX44 (20GB) com Otimizações

**Se Hetzner não oferecer customizado:**
- ✅ Usar GEX44 (€184/mês)
- ✅ Implementar fila GPU obrigatória
- ✅ Reduzir GPU_MEMORY_UTILIZATION para 0.85
- ✅ Monitorar VRAM constantemente
- ⚠️ Aceitar risco de OOM em cenários raros

### Opção 2: Aguardar Disponibilidade

**Se GEX44 estiver esgotado:**
- Aguardar disponibilidade (verificar Robot periodicamente)
- Configurar alerta de disponibilidade (se Hetzner oferecer)

### Opção 3: Outros Provedores

**Alternativas externas:**
- **OVH:** Servidores GPU dedicados
- **Online.net:** Servidores GPU
- **Contabo:** Servidores GPU (mais barato, mas menos confiável)

---

## 📊 Comparação Final

| Opção | VRAM | Custo/mês | Risco OOM | Recomendação |
|-------|------|-----------|-----------|--------------|
| **GEX44 (20GB)** | 20GB | €184 | ⚠️ Médio-Alto | ⚠️ Funciona com cuidados |
| **Custom RTX 3090 (24GB)** | 24GB | ~€200-250 | ✅ Baixo | ✅ **RECOMENDADO** |
| **Custom RTX 4090 (24GB)** | 24GB | ~€250-300 | ✅ Muito Baixo | ✅ Ideal (se orçamento permitir) |

---

## 🎯 Minha Recomendação

**Prioridade 1:** Solicitar servidor customizado com RTX 3090/4090 24GB
- ✅ Mesmo VRAM que planejamos originalmente
- ✅ Custo apenas +€16-116/mês
- ✅ Sem riscos de OOM
- ✅ Margem de segurança confortável

**Prioridade 2 (se customizado não for viável):** Usar GEX44 com otimizações
- ⚠️ Funciona, mas requer cuidados
- ⚠️ Risco de OOM em cenários raros

---

## 📝 Checklist

- [ ] Acessar Hetzner Robot
- [ ] Criar ticket de suporte
- [ ] Enviar solicitação com especificações
- [ ] Aguardar resposta (1-2 dias)
- [ ] Avaliar proposta (custo, tempo, specs)
- [ ] Aprovar ou negociar
- [ ] Aguardar provisionamento (3-7 dias)
- [ ] Configurar servidor (seguir `docs/PLANO-IMPLEMENTACAO-DEPLOY-SERVER.md`)

---

**Autor:** Fillipe Guerra  
**Data:** 25 de Dezembro de 2025

