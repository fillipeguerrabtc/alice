# Guia: Configuração do Pedido GEX44 na Hetzner Robot

**Autor:** Fillipe Guerra  
**Data:** 25 de Dezembro de 2025  
**Versão:** 1.0

---

## ⚠️ IMPORTANTE: GEX44 NÃO Pode Ser Customizado

**Limitações do GEX44:**
- ❌ GPU fixa: RTX 4000 SFF Ada (20GB) - **NÃO pode ser alterada**
- ❌ CPU fixa: Intel Core i5-13500 (14 cores) - **NÃO pode ser alterada**
- ❌ RAM fixa: 64GB DDR4 - **NÃO pode ser alterada**
- ❌ Storage fixo: 2x 1.92TB NVMe SSD - **NÃO pode ser alterado**

**O que PODE ser configurado:**
- ✅ Localização (FSN1 - Falkenstein, Germany)
- ✅ Sistema Operacional (Ubuntu 24.04 LTS recomendado)
- ✅ Idioma (English)
- ✅ Addons (USB sticks opcionais)
- ✅ Quantidade de servidores

---

## 📋 Configuração Recomendada para GEX44

### Passo 1: Localização

**Selecionar:**
- ✅ **FSN1 (Falkenstein)** - Germany
- **Custo:** €182.30/mês + €159.00 setup

**Por quê:**
- Mesma região do Deploy Server (reduz latência)
- Preço competitivo
- Boa conectividade

---

### Passo 2: IPv4 Addresses

**Selecionar:**
- ✅ **1 IPv4 address** (padrão)
- **Custo:** €1.70/mês (já incluído)

**Nota:** IPs adicionais podem ser adicionados depois se necessário.

---

### Passo 3: Sistema Operacional

**Selecionar:**
- ✅ **Ubuntu 24.04 LTS base**
- **NÃO selecionar:** Windows Server (custo adicional €49-303/mês)

**Por quê:**
- Ubuntu 24.04 LTS é a versão mais recente e estável
- Suporte completo para Docker e NVIDIA drivers
- Documentação e scripts da Alice são testados para Ubuntu 24.04

**Alternativas (se Ubuntu não disponível):**
- Debian 12 base (segunda opção)
- Debian 13 base (se disponível)

---

### Passo 4: Idioma

**Selecionar:**
- ✅ **English** (padrão)

**Por quê:**
- Scripts e documentação da Alice são em inglês
- Facilita troubleshooting e suporte

---

### Passo 5: Addons

**Selecionar:**
- ❌ **Nenhum addon necessário**

**Addons disponíveis:**
- 16 GB USB Stick (€1.60/mês) - **NÃO necessário**
- 64 GB USB Stick (€2.50/mês) - **NÃO necessário**

**Por quê:**
- Servidor já tem 1.92TB de storage (suficiente)
- USB sticks são para backup físico (não necessário para nossa arquitetura)

---

### Passo 6: Number of Servers

**Selecionar:**
- ✅ **1 server** (padrão)

---

### Passo 7: Finalizar Pedido

1. Clique em **"Add to shopping cart"**
2. Revise o pedido no carrinho
3. Confirme e finalize o pagamento

---

## ⚠️ ANTES DE FINALIZAR: Considerar Servidor Customizado

### Por que considerar customizado ANTES de pedir GEX44:

| Aspecto | GEX44 (20GB) | Custom RTX 3090/4090 (24GB) |
|---------|--------------|----------------------------|
| **VRAM** | 20GB (apertado) | 24GB (confortável) |
| **Custo/mês** | €184 | ~€200-300 (+€16-116) |
| **Risco OOM** | ⚠️ Médio-Alto | ✅ Baixo |
| **Customização** | ❌ Nenhuma | ✅ Total |

### Recomendação:

**Se você ainda não pediu o GEX44:**
1. ✅ **Pause o pedido do GEX44**
2. ✅ **Solicite servidor customizado primeiro** (via ticket de suporte)
3. ✅ **Aguarde resposta** (1-2 dias)
4. ✅ **Decida baseado na proposta** (custo, tempo, specs)

**Se já pediu o GEX44:**
- ✅ Pode usar, mas com otimizações obrigatórias
- ⚠️ Implementar fila GPU obrigatória
- ⚠️ Reduzir GPU_MEMORY_UTILIZATION para 0.85
- ⚠️ Monitorar VRAM constantemente

---

## 📝 Checklist de Configuração

- [ ] Localização: FSN1 (Falkenstein)
- [ ] IPv4: 1 address (padrão)
- [ ] Sistema Operacional: Ubuntu 24.04 LTS base
- [ ] Idioma: English
- [ ] Addons: Nenhum
- [ ] Quantidade: 1 server
- [ ] Revisar custo total: €182.30/mês + €159.00 setup
- [ ] Considerar servidor customizado antes de finalizar

---

## 🚀 Após Pedir o GEX44

### 1. Aguardar Provisionamento

- **Tempo:** 1-3 horas (geralmente rápido)
- **Notificação:** Email da Hetzner com IP e credenciais

### 2. Configurar GitHub Secrets

1. Acesse: https://github.com/fillipeguerrabtc/alice/settings/secrets/actions
2. Atualize:
   - `HETZNER_VM_HOST` = IP do GEX44
   - `PRODUCTION_SERVER_HOST` = IP do GEX44
   - `PRODUCTION_SERVER_USER` = `alice-deploy` (ou `root`)

### 3. Configurar Otimizações GPU (OBRIGATÓRIO)

**Ajustar `docker-compose.prod.yml`:**
```yaml
# GPU Mixtral - Reduzir para 0.85 (17GB ao invés de 18GB)
gpu-mixtral:
  environment:
    GPU_MEMORY_UTILIZATION: 0.85  # 85% de 20GB = 17GB
```

**Verificar GPU Manager Service:**
- ✅ Fila priorizada implementada
- ✅ Monitoramento VRAM ativo
- ✅ Alerts para OOM configurados

### 4. Testar Deploy

1. Disparar workflow manualmente
2. Verificar logs do deploy
3. Validar health checks
4. Testar cenários de pico (chat + RAG simultâneo)

---

## 📊 Resumo de Custos

| Item | Custo |
|------|-------|
| **GEX44 (mensal)** | €182.30/mês |
| **Setup (one-time)** | €159.00 |
| **IPv4 (mensal)** | €1.70/mês (já incluído) |
| **Total primeiro mês** | €343.00 |
| **Total mensal (após setup)** | €184.00/mês |

**Comparação:**
- GEX44: €184/mês (20GB VRAM)
- Custom RTX 3090: ~€200-250/mês (24GB VRAM) - **+€16-66/mês**
- Custom RTX 4090: ~€250-300/mês (24GB VRAM) - **+€66-116/mês**

---

## ✅ Conclusão

**GEX44 é suficiente se:**
- ✅ Você aceita risco de OOM em cenários raros
- ✅ Você implementa todas as otimizações obrigatórias
- ✅ Você monitora VRAM constantemente

**Recomendação final:**
- ⚠️ **Se ainda não pediu:** Solicite servidor customizado primeiro
- ✅ **Se já pediu:** Use GEX44 com otimizações obrigatórias

---

**Autor:** Fillipe Guerra  
**Data:** 25 de Dezembro de 2025

