# Guia Rápido: Servidores GPU Disponíveis na Hetzner

**Autor:** Fillipe Guerra  
**Data:** 25 de Dezembro de 2025  
**Versão:** 1.0.0

---

## ⚠️ Situação Atual

Se você está vendo apenas servidores caros (como GEX131 por €889/mês) na Hetzner Robot, aqui estão as opções:

---

## Opções Disponíveis

### 1. GEX131 (Disponível - Mais Caro)

**O que você vê na Robot:**
- GPU: NVIDIA RTX PRO 6000 Blackwell Max-Q
- VRAM: **96GB** (muito mais que necessário)
- CPU: Intel Xeon Gold 5412U (24-core)
- RAM: 256GB DDR5
- Storage: 2x 960GB NVMe SSD
- **Custo**: €889/mês + €159 setup

**Vantagens:**
- ✅ Disponível imediatamente
- ✅ GPU excelente (96GB permite modelos muito maiores)
- ✅ Muito mais RAM (256GB vs 64GB)

**Desvantagens:**
- ❌ Muito caro (€889/mês)
- ❌ GPU muito mais potente que o necessário

**Recomendação**: Use se quiser começar rápido, mas é caro.

---

### 2. GEX44 (Pode Não Aparecer)

**Se aparecer na Robot:**
- GPU: NVIDIA RTX 4000 SFF Ada
- VRAM: **20GB** (suficiente com otimização)
- CPU: Intel Core i5-13500
- RAM: 64GB DDR4
- Storage: 2x 1.92TB NVMe SSD
- **Custo**: €184/mês + €79 setup

**Vantagens:**
- ✅ Preço razoável
- ✅ 20GB suficiente para nossos modelos (com otimização)
- ✅ 64GB RAM suficiente para 49 containers

**Desvantagens:**
- ⚠️ Pode não aparecer (esgotado ou sob demanda)

**Recomendação**: Se aparecer, use este (melhor custo-benefício).

---

### 3. Servidor Customizado (Contatar Suporte)

**Especificações Desejadas:**
- GPU: RTX 3090 ou RTX 4090 (24GB VRAM)
- CPU: 8+ cores
- RAM: 64GB+
- Storage: 500GB+ NVMe SSD
- **Custo estimado**: €200-300/mês

**Como solicitar:**
1. Acesse [Hetzner Robot](https://robot.your-server.de/)
2. Vá em "Support" → "Create Ticket"
3. Solicite: "Servidor dedicado customizado com GPU RTX 3090 ou RTX 4090 (24GB VRAM)"
4. Especifique: CPU 8+ cores, 64GB+ RAM, 500GB+ NVMe SSD
5. Localização: Nuremberg

**Vantagens:**
- ✅ GPU ideal (24GB, mesma que Salad Cloud)
- ✅ Custo razoável (€200-300/mês)
- ✅ Configuração sob medida

**Desvantagens:**
- ⚠️ Pode levar alguns dias para provisionar
- ⚠️ Precisa contatar suporte

**Recomendação**: Melhor opção se tiver tempo para aguardar.

---

## Decisão Rápida

| Situação | Ação |
|----------|------|
| **GEX44 aparece** | ✅ Use GEX44 (€184/mês) |
| **Só GEX131 aparece** | ⚠️ Use GEX131 (€889/mês) ou contate suporte |
| **Nenhum aparece** | 📞 Contate suporte para customizado |

---

## Próximos Passos (Independente da Opção)

1. **Provisionar servidor** (qualquer uma das opções acima)
2. **Configurar SSH** (chave SSH no GitHub Secrets)
3. **Atualizar GitHub Secrets**:
   - `HETZNER_VM_HOST` = IP do novo servidor
   - Manter `HETZNER_VM_USER` = `root`
   - Manter `HETZNER_SSH_PRIVATE_KEY` = mesma chave
4. **Fazer push** → Pipeline instala tudo automaticamente

**O pipeline faz:**
- ✅ Instala Docker automaticamente
- ✅ Instala NVIDIA Driver (se GPU presente)
- ✅ Instala NVIDIA Container Toolkit
- ✅ Cria estrutura de diretórios
- ✅ Configura firewall
- ✅ Deploy de todos os 49 containers

**Você não precisa instalar nada manualmente!**

---

**Autor:** Fillipe Guerra  
**Data:** 25 de Dezembro de 2025

