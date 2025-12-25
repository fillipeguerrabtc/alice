# Guia Passo a Passo: Provisionamento Hetzner Cloud GPU

**Autor:** Fillipe Guerra  
**Data:** 25 de Dezembro de 2025  
**Versão:** 1.0.0 - Guia Completo de Provisionamento  
**Status:** Implementação

---

## Sumário

Este guia fornece instruções passo a passo para provisionar um servidor GPU na Hetzner Cloud e configurá-lo para rodar os serviços GPU da Alice Enterprise Platform.

---

## 1. Pré-requisitos

- [ ] Conta Hetzner Cloud ativa ([console.hetzner.cloud](https://console.hetzner.cloud))
- [ ] Método de pagamento configurado
- [ ] Acesso SSH configurado (chave SSH)
- [ ] Conhecimento básico de Linux e Docker

> **⚠️ IMPORTANTE**: Este guia é para criar um **NOVO servidor GPU que SUBSTITUIRÁ o CX43 atual**. Todos os 45 containers serão migrados para o novo servidor, que também terá os 4 serviços GPU. **Total: 49 containers em 1 servidor único**. Como não há dados ainda (deploy nunca funcionou), a migração será simples - apenas provisionar novo servidor e fazer deploy completo.

---

## 2. Escolha do Servidor GPU

### Opção A: Servidor GEX131 (Disponível na Robot)

**Especificações:**
- GPU: NVIDIA RTX PRO 6000 Blackwell Max-Q (96GB VRAM)
- CPU: Intel Xeon Gold 5412U (24-core)
- RAM: 256GB DDR5 ECC
- Storage: 2x 960GB NVMe SSD (Software RAID 1)
- **Custo**: €889/mês + €159 setup fee

**Passos:**
1. Acesse [Hetzner Robot](https://robot.your-server.de/)
2. Clique em "Order Server" → "GPU Servers"
3. Selecione **GEX131**
4. Escolha localização (Nuremberg)
5. Configure sistema operacional (Ubuntu 24.04 LTS recomendado)
6. Finalize pedido

**Nota**: Muito mais caro, mas GPU excelente (96GB VRAM permite modelos muito maiores).

### Opção B: Servidor GEX44 (Se Disponível)

**Especificações:**
- GPU: NVIDIA RTX 4000 SFF Ada (20GB VRAM)
- CPU: Intel Core i5-13500
- RAM: 64GB DDR4
- Storage: 2x 1.92TB NVMe SSD
- **Custo**: €184/mês + €79 setup fee

**Passos:**
1. Acesse [Hetzner Robot](https://robot.your-server.de/)
2. Clique em "Order Server" → "GPU Servers"
3. Se **GEX44** aparecer, selecione
4. Escolha localização (Nuremberg)
5. Configure sistema operacional (Ubuntu 24.04 LTS recomendado)
6. Finalize pedido

**Nota**: Se não aparecer, pode estar esgotado. Use GEX131 ou contate suporte.

### Opção C: Servidor Customizado (Contatar Suporte)

**Especificações Desejadas:**
- GPU: NVIDIA RTX 3090 ou RTX 4090 (24GB VRAM)
- CPU: 8+ cores (AMD ou Intel)
- RAM: 64GB+ DDR4
- Storage: 500GB+ NVMe SSD

**Passos:**
1. Acesse [Hetzner Robot](https://robot.your-server.de/)
2. Abra ticket de suporte
3. Solicite servidor customizado com RTX 3090/4090
4. Especifique localização (Nuremberg)
5. **Custo estimado**: €200-300/mês

**Recomendação**: Se GEX44 não aparecer, **GEX131** é a opção mais rápida (mas cara). Para economia, contate suporte para customizado.

---

## 3. Provisionamento do Servidor

### 3.1 Acesso Inicial

Após o servidor ser provisionado (pode levar 1-24 horas):

1. **Receber credenciais**:
   - IP do servidor
   - Senha root (temporária)
   - Ou usar chave SSH se configurada

2. **Conectar via SSH**:
   ```bash
   ssh root@<IP_DO_SERVIDOR>
   # Ou com chave SSH:
   ssh -i ~/.ssh/hetzner-gpu root@<IP_DO_SERVIDOR>
   ```

3. **Atualizar sistema**:
   ```bash
   apt update && apt upgrade -y
   reboot
   ```

### 3.2 Configuração Básica

```bash
# 1. Criar usuário não-root (opcional, mas recomendado)
adduser alice
usermod -aG sudo alice

# 2. Configurar hostname
hostnamectl set-hostname alice-gpu-01

# 3. Configurar timezone
timedatectl set-timezone America/Sao_Paulo

# 4. Instalar ferramentas essenciais
apt install -y \
  curl \
  wget \
  git \
  vim \
  htop \
  net-tools \
  ufw \
  fail2ban
```

---

## 4. Instalação Automática via Pipeline

> **✅ IMPORTANTE**: Você **NÃO precisa instalar nada manualmente**! O pipeline CI/CD instala tudo automaticamente na primeira execução.

O workflow `deploy-production.yml` verifica e instala automaticamente:
- ✅ Docker e Docker Compose
- ✅ NVIDIA Driver (se GPU presente)
- ✅ NVIDIA Container Toolkit (se GPU presente)
- ✅ Estrutura de diretórios
- ✅ Redes Docker
- ✅ Firewall

**Você só precisa:**
1. Provisionar o servidor GPU na Hetzner
2. Configurar SSH access (chave SSH)
3. Atualizar GitHub Secrets com novo IP
4. Fazer push → Pipeline instala tudo automaticamente

---

## 4. Instalação Manual (Opcional - Apenas se quiser testar antes)

> **Nota**: Esta seção é opcional. O pipeline faz tudo automaticamente.

### 4.1 Instalar Docker

```bash
# Remover versões antigas (se houver)
apt remove -y docker docker-engine docker.io containerd runc

# Instalar dependências
apt update
apt install -y \
  ca-certificates \
  curl \
  gnupg \
  lsb-release

# Adicionar repositório Docker
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(lsb_release -cs) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null

# Instalar Docker
apt update
apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Adicionar usuário ao grupo docker
usermod -aG docker alice  # ou root se usar root

# Verificar instalação
docker --version
docker compose version
```

### 4.2 Instalar NVIDIA Driver

```bash
# Verificar GPU detectada
lspci | grep -i nvidia

# Instalar driver NVIDIA
apt update
apt install -y nvidia-driver-535  # ou versão mais recente

# Verificar instalação
nvidia-smi

# Deve mostrar:
# - Driver Version
# - CUDA Version
# - GPU Name (RTX 3090/4090/4000)
# - Memory Total
```

### 4.3 Instalar NVIDIA Container Toolkit

```bash
# Adicionar repositório NVIDIA
distribution=$(. /etc/os-release;echo $ID$VERSION_ID)
curl -s -L https://nvidia.github.io/nvidia-docker/gpgkey | apt-key add -
curl -s -L https://nvidia.github.io/nvidia-docker/$distribution/nvidia-docker.list | \
  tee /etc/apt/sources.list.d/nvidia-docker.list

# Instalar NVIDIA Container Toolkit
apt update
apt install -y nvidia-container-toolkit

# Reiniciar Docker
systemctl restart docker

# Verificar configuração
docker run --rm --gpus all nvidia/cuda:12.0.0-base-ubuntu22.04 nvidia-smi
```

---

## 5. Configuração de Rede

### 5.1 Configurar Firewall (UFW)

```bash
# Permitir SSH
ufw allow 22/tcp

# Permitir portas dos serviços GPU (rede interna apenas)
# Nota: Estas portas serão acessíveis apenas na rede interna Hetzner
ufw allow from 10.0.0.0/8 to any port 8000:8003

# Permitir portas de monitoramento (opcional)
ufw allow from 10.0.0.0/8 to any port 9090  # Prometheus
ufw allow from 10.0.0.0/8 to any port 3000  # Grafana

# Ativar firewall
ufw enable
ufw status
```

### 5.2 Configurar Rede (Servidor Único)

Como tudo roda no mesmo servidor, não é necessário configurar rede interna:

- **Todos os serviços usam localhost** (latência zero)
- **Firewall**: Apenas portas públicas necessárias (80, 443)
- **Portas internas**: 8000-8003 (GPU services) não precisam ser expostas externamente
- **Traefik**: Roteia internamente para serviços GPU via localhost

**Configuração de Firewall Simplificada:**

```bash
# Permitir SSH
ufw allow 22/tcp

# Permitir HTTP/HTTPS (Traefik)
ufw allow 80/tcp
ufw allow 443/tcp

# Portas GPU (apenas localhost, não expor)
# 8000-8003 ficam apenas para comunicação interna

# Ativar firewall
ufw enable
```

---

## 6. Preparação do Ambiente

### 6.1 Criar Estrutura de Diretórios

```bash
# Criar diretório principal
mkdir -p /opt/alice-gpu
cd /opt/alice-gpu

# Criar subdiretórios
mkdir -p {config,logs,data,scripts}

# Configurar permissões
chown -R alice:alice /opt/alice-gpu  # ou root:root se usar root
```

### 6.2 Clonar Repositório (Opcional)

```bash
# Se quiser ter código no servidor GPU (para debug)
cd /opt/alice-gpu
git clone https://github.com/fillipeguerrabtc/alice.git code

# Ou apenas baixar docker-compose.gpu.yml
curl -O https://raw.githubusercontent.com/fillipeguerrabtc/alice/main/infra/docker/docker-compose.gpu.yml
```

---

## 7. Configuração de Monitoramento

### 7.1 Instalar Node Exporter (Opcional)

```bash
# Baixar Node Exporter
cd /tmp
wget https://github.com/prometheus/node_exporter/releases/download/v1.8.2/node_exporter-1.8.2.linux-amd64.tar.gz
tar xvf node_exporter-1.8.2.linux-amd64.tar.gz
cp node_exporter-1.8.2.linux-amd64/node_exporter /usr/local/bin/

# Criar serviço systemd
cat > /etc/systemd/system/node-exporter.service <<EOF
[Unit]
Description=Node Exporter
After=network.target

[Service]
Type=simple
User=root
ExecStart=/usr/local/bin/node_exporter
Restart=always

[Install]
WantedBy=multi-user.target
EOF

# Iniciar serviço
systemctl daemon-reload
systemctl enable node-exporter
systemctl start node-exporter

# Verificar
systemctl status node-exporter
curl http://localhost:9100/metrics
```

### 7.2 Configurar NVIDIA SMI Monitoring

```bash
# Criar script para métricas GPU
cat > /opt/alice-gpu/scripts/gpu-metrics.sh <<'EOF'
#!/bin/bash
# Exporta métricas GPU para Prometheus

nvidia-smi --query-gpu=index,name,memory.used,memory.total,utilization.gpu,utilization.memory,temperature.gpu --format=csv,noheader,nounits | \
  awk -F', ' '{print "gpu_info{index=\""$1"\",name=\""$2"\"} 1"; \
               print "gpu_memory_used_bytes{index=\""$1"\"} " $3 "*1024*1024; \
               print "gpu_memory_total_bytes{index=\""$1"\"} " $4 "*1024*1024; \
               print "gpu_utilization_percent{index=\""$1"\"} " $5; \
               print "gpu_memory_utilization_percent{index=\""$1"\"} " $6; \
               print "gpu_temperature_celsius{index=\""$1"\"} " $7}'
EOF

chmod +x /opt/alice-gpu/scripts/gpu-metrics.sh
```

---

## 8. Verificação Final

### 8.1 Checklist de Verificação

- [ ] Servidor provisionado e acessível via SSH
- [ ] Docker instalado e funcionando
- [ ] NVIDIA driver instalado (`nvidia-smi` funciona)
- [ ] NVIDIA Container Toolkit instalado
- [ ] Firewall configurado
- [ ] Rede interna configurada (se aplicável)
- [ ] Diretórios criados
- [ ] Monitoramento configurado (opcional)

### 8.2 Teste de GPU no Docker

```bash
# Testar GPU no Docker
docker run --rm --gpus all nvidia/cuda:12.0.0-base-ubuntu22.04 nvidia-smi

# Deve mostrar informações da GPU
```

---

## 9. Próximos Passos

Após completar este guia:

1. **Criar `docker-compose.gpu.yml`** (ver próximo documento)
2. **Configurar variáveis de ambiente**
3. **Deploy dos serviços GPU**
4. **Integração com servidor CX43**

---

## 10. Troubleshooting

### GPU não detectada

```bash
# Verificar se GPU está presente
lspci | grep -i nvidia

# Verificar driver
nvidia-smi

# Reinstalar driver se necessário
apt remove --purge nvidia-*
apt install -y nvidia-driver-535
reboot
```

### Docker não acessa GPU

```bash
# Verificar NVIDIA Container Toolkit
nvidia-container-cli --version

# Testar acesso
docker run --rm --gpus all nvidia/cuda:12.0.0-base-ubuntu22.04 nvidia-smi

# Se falhar, reinstalar
apt remove --purge nvidia-container-toolkit
apt install -y nvidia-container-toolkit
systemctl restart docker
```

### Problemas de Rede

```bash
# Verificar conectividade
ping <IP_DO_CX43>

# Verificar firewall
ufw status

# Testar portas
nc -zv <IP_DO_CX43> 8000
```

---

## 11. Custos e Faturamento

### Estimativa de Custos

| Item | Custo Mensal | Setup Fee | Observação |
|------|--------------|-----------|------------|
| **GEX131** | €889 | €159 | RTX PRO 6000 96GB (disponível) |
| **GEX44** | €184 | €79 | RTX 4000 20GB (pode não aparecer) |
| **Custom RTX 3090/4090** | €200-300 | €0-159 | 24GB (contatar suporte) |
| **Tráfego** | Incluído | - | Primeiros 20TB/mês |
| **Backup** | Opcional | - | ~€10-20/mês |

**Total Estimado**: 
- **GEX131**: €889/mês (mais caro, mas GPU excelente)
- **GEX44**: €184/mês (mais barato, se disponível)
- **Custom**: €200-300/mês (ideal, mas precisa contatar suporte)

**Recomendação**: Se GEX44 não aparecer, use **GEX131** para começar rápido, ou contate suporte para customizado mais barato.

---

**Autor:** Fillipe Guerra  
**Data:** 25 de Dezembro de 2025  
**Versão:** 1.0.0

