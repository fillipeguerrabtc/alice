# Plano de Implementação Completo: Migração Salad Cloud → Hetzner GPU

**Autor:** Fillipe Guerra  
**Data:** 25 de Dezembro de 2025  
**Versão:** 1.0.0 - Plano Detalhado de Implementação  
**Status:** Implementação

---

## Sumário

Este documento fornece um plano passo a passo completo para implementar a migração de Salad Cloud para Hetzner Cloud GPU, incluindo todas as fases, comandos, verificações e rollback.

---

## Fase 1: Preparação (Semana 1)

### 1.1 Provisionamento Hetzner GPU

**Duração**: 1-2 dias (depende da disponibilidade)

**Passos**:

1. **Escolher servidor GPU**:
   - **Opção A**: Servidor customizado com RTX 3090/4090 (24GB) - €200-300/mês
   - **Opção B**: GEX44 com RTX 4000 (20GB) - €184/mês + €79 setup

2. **Seguir guia completo**: `docs/GUIA-PROVISIONAMENTO-HETZNER-GPU.md`

3. **Verificações**:
   ```bash
   # No servidor GPU
   nvidia-smi                    # Deve mostrar GPU
   docker --version              # Docker instalado
   docker compose version        # Docker Compose instalado
   docker run --rm --gpus all nvidia/cuda:12.0.0-base-ubuntu22.04 nvidia-smi
   ```

**Checklist**:
- [ ] Servidor GPU provisionado
- [ ] Docker e NVIDIA Container Toolkit instalados
- [ ] GPU detectada e funcionando
- [ ] Rede interna configurada (se aplicável)
- [ ] Firewall configurado
- [ ] SSH acesso configurado

### 1.2 Preparação de Código

**Duração**: 2-3 dias

#### 1.2.1 Criar docker-compose.gpu.yml

- [ ] Arquivo criado: `infra/docker/docker-compose.gpu.yml`
- [ ] 4 serviços configurados (mixtral, embeddings, flux, asr)
- [ ] Health checks configurados
- [ ] Resource limits definidos
- [ ] Network configurada

#### 1.2.2 Atualizar docker-compose.prod.yml

**Arquivo**: `infra/docker/docker-compose.prod.yml`

**Mudanças**:
- [ ] Remover variáveis `SALAD_*` dos services
- [ ] Adicionar variáveis `GPU_*_URL` apontando para servidor GPU
- [ ] Atualizar `chat-service` environment
- [ ] Atualizar `rag-service` environment
- [ ] Atualizar `training-service` environment

**Exemplo de mudança**:
```yaml
# ANTES (chat-service)
environment:
  - SALAD_MIXTRAL_URL=${SALAD_MIXTRAL_URL}

# DEPOIS (chat-service)
environment:
  - GPU_MIXTRAL_URL=http://<IP_GPU_SERVER>:8000
```

#### 1.2.3 Atualizar Código dos Services

**Arquivo**: `apps/chat-service/src/llm-client.ts`

- [ ] Remover import de `salad-client.ts`
- [ ] Remover lógica de Salad Cloud
- [ ] Atualizar para usar `GPU_MIXTRAL_URL` diretamente
- [ ] Manter mesma interface (OpenAI-compatible)

**Arquivo**: `apps/rag-service/src/index.ts`

- [ ] Remover import de `salad-client.ts`
- [ ] Atualizar `EMBEDDINGS_GPU_URL` para `GPU_EMBEDDINGS_URL`
- [ ] Atualizar `SALAD_ASR_URL` para `GPU_ASR_URL`
- [ ] Manter mesma interface

**Arquivo**: `apps/training-service/src/index.ts`

- [ ] Remover import de `salad-client.ts`
- [ ] Atualizar para usar `GPU_FLUX_URL`
- [ ] Remover lógica de criação de Container Groups

#### 1.2.4 Atualizar Secrets

**GitHub Secrets** (remover):
- [ ] `SALAD_API_KEY`
- [ ] `SALAD_ORGANIZATION_ID`
- [ ] `SALAD_PROJECT_ID`
- [ ] `SALAD_MIXTRAL_URL`
- [ ] `SALAD_EMBEDDINGS_URL`
- [ ] `SALAD_FLUX_URL`
- [ ] `SALAD_ASR_URL`

**GitHub Secrets** (adicionar):
- [ ] `GPU_SERVER_IP` (IP do servidor GPU)
- [ ] `GPU_SERVER_SSH_KEY` (chave SSH para servidor GPU)
- [ ] `GPU_MIXTRAL_URL` (http://<IP>:8000)
- [ ] `GPU_EMBEDDINGS_URL` (http://<IP>:8001)
- [ ] `GPU_FLUX_URL` (http://<IP>:8002)
- [ ] `GPU_ASR_URL` (http://<IP>:8003)

**Arquivo `.env.prod`** (no servidor CX43):
```bash
# GPU Services (Hetzner GPU Server)
GPU_SERVER_IP=10.0.0.20  # ou IP público se não usar rede interna
GPU_MIXTRAL_URL=http://${GPU_SERVER_IP}:8000
GPU_EMBEDDINGS_URL=http://${GPU_SERVER_IP}:8001
GPU_FLUX_URL=http://${GPU_SERVER_IP}:8002
GPU_ASR_URL=http://${GPU_SERVER_IP}:8003
```

### 1.3 Testes Locais

**Duração**: 1 dia

- [ ] Testar build das imagens GPU localmente (se possível)
- [ ] Validar docker-compose.gpu.yml (syntax check)
- [ ] Testar conectividade entre CX43 e GPU server
- [ ] Validar latência de rede (<1ms se rede interna)

**Comandos de teste**:
```bash
# No servidor GPU
cd /opt/alice-gpu
docker compose -f docker-compose.gpu.yml config  # Validar syntax

# Testar conectividade (do CX43)
ping <IP_GPU_SERVER>
curl http://<IP_GPU_SERVER>:8000/health  # Após deploy
```

---

## Fase 2: Implementação (Semana 2)

### 2.1 Build e Push das Imagens GPU

**Duração**: 1 dia

**No servidor de CI/CD (GitHub Actions)**:

1. **Build das imagens**:
   ```bash
   # As imagens já são buildadas no CI atual
   # Verificar se estão sendo publicadas no GHCR
   ```

2. **Verificar imagens no GHCR**:
   - [ ] `ghcr.io/fillipeguerrabtc/alice-mixtral-vllm:latest`
   - [ ] `ghcr.io/fillipeguerrabtc/alice-embeddings-gpu:latest`
   - [ ] `ghcr.io/fillipeguerrabtc/alice-flux-schnell:latest`
   - [ ] `ghcr.io/fillipeguerrabtc/alice-asr-canary:latest`

### 2.2 Deploy GPU Services

**Duração**: 1 dia

**No servidor GPU**:

1. **Criar diretório e arquivos**:
   ```bash
   mkdir -p /opt/alice-gpu
   cd /opt/alice-gpu
   
   # Copiar docker-compose.gpu.yml
   # Ou clonar repositório
   git clone https://github.com/fillipeguerrabtc/alice.git .
   ```

2. **Criar .env.gpu**:
   ```bash
   cat > .env.gpu <<EOF
   DOCKERHUB_USERNAME=fillipeguerrabtc
   IMAGE_TAG=latest
   HUGGINGFACE_TOKEN=${HUGGINGFACE_TOKEN}
   MIXTRAL_MODEL_NAME=TheBloke/Mixtral-8x7B-Instruct-v0.1-AWQ
   MIXTRAL_QUANTIZATION=awq
   MIXTRAL_MAX_MODEL_LEN=32768
   MIXTRAL_GPU_MEMORY_UTILIZATION=0.90
   TEXT_MODEL_NAME=Qwen/Qwen3-Embedding-8B
   IMAGE_MODEL_NAME=laion/CLIP-ViT-H-14-laion2B-s32B-b79K
   FLUX_MODEL_NAME=black-forest-labs/FLUX.1-schnell
   ASR_MODEL_NAME=nvidia/canary-1b
   EOF
   ```

3. **Deploy**:
   ```bash
   docker compose -f docker-compose.gpu.yml --env-file .env.gpu pull
   docker compose -f docker-compose.gpu.yml --env-file .env.gpu up -d
   ```

4. **Verificar logs**:
   ```bash
   docker compose -f docker-compose.gpu.yml logs -f
   ```

5. **Verificar health**:
   ```bash
   docker compose -f docker-compose.gpu.yml ps
   curl http://localhost:8000/health  # Mixtral
   curl http://localhost:8001/health  # Embeddings
   curl http://localhost:8002/health  # FLUX
   curl http://localhost:8003/health  # ASR
   ```

**Checklist**:
- [ ] Todas as 4 imagens baixadas
- [ ] Todos os 4 containers rodando
- [ ] Todos os health checks passando
- [ ] Logs sem erros críticos
- [ ] GPU sendo utilizada (`nvidia-smi` mostra processos)

### 2.3 Atualização Alice Services

**Duração**: 2 dias

**No servidor CX43**:

1. **Atualizar .env.prod**:
   ```bash
   # Adicionar variáveis GPU
   echo "GPU_SERVER_IP=<IP_GPU_SERVER>" >> .env.prod
   echo "GPU_MIXTRAL_URL=http://\${GPU_SERVER_IP}:8000" >> .env.prod
   echo "GPU_EMBEDDINGS_URL=http://\${GPU_SERVER_IP}:8001" >> .env.prod
   echo "GPU_FLUX_URL=http://\${GPU_SERVER_IP}:8002" >> .env.prod
   echo "GPU_ASR_URL=http://\${GPU_SERVER_IP}:8003" >> .env.prod
   ```

2. **Atualizar código** (já feito na Fase 1.2.3)

3. **Rebuild e redeploy**:
   ```bash
   # Via GitHub Actions (push para main)
   # Ou manualmente:
   cd /opt/alice/app
   git pull
   docker compose -f docker-compose.prod.yml up -d --build
   ```

4. **Verificar serviços**:
   ```bash
   docker compose -f docker-compose.prod.yml ps
   docker logs alice-chat --tail 50
   docker logs alice-rag --tail 50
   docker logs alice-training --tail 50
   ```

**Checklist**:
- [ ] .env.prod atualizado
- [ ] Código atualizado (sem referências Salad)
- [ ] Containers rebuildados
- [ ] Serviços Alice conectando ao GPU server
- [ ] Logs sem erros de conexão

### 2.4 Configuração de Rede

**Duração**: 1 dia

1. **Rede Interna Hetzner** (se aplicável):
   - [ ] Network criada no Hetzner Cloud Console
   - [ ] CX43 adicionado à network
   - [ ] GPU server adicionado à network
   - [ ] IPs estáticos configurados

2. **Firewall**:
   ```bash
   # No servidor GPU
   ufw allow from <IP_CX43> to any port 8000:8003
   ufw reload
   ```

3. **Teste de conectividade**:
   ```bash
   # Do CX43
   ping <IP_GPU_SERVER>
   curl http://<IP_GPU_SERVER>:8000/health
   ```

**Checklist**:
- [ ] Rede interna configurada (se aplicável)
- [ ] Firewall permitindo apenas IP do CX43
- [ ] Conectividade testada e funcionando
- [ ] Latência <1ms (rede interna) ou <50ms (pública)

---

## Fase 3: Validação (Semana 3)

### 3.1 Testes Funcionais

**Duração**: 2 dias

#### 3.1.1 Teste Chat (LLM)

```bash
# Testar endpoint diretamente
curl -X POST http://<IP_GPU_SERVER>:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "mixtral-8x7b",
    "messages": [{"role": "user", "content": "Hello"}],
    "max_tokens": 100
  }'
```

**Verificações**:
- [ ] Resposta recebida em <2s
- [ ] Tokens sendo gerados
- [ ] Sem erros no log

#### 3.1.2 Teste Embeddings

```bash
# Texto
curl -X POST http://<IP_GPU_SERVER>:8001/embed/text \
  -H "Content-Type: application/json" \
  -d '{"text": "Hello world"}'

# Imagem (upload file)
curl -X POST http://<IP_GPU_SERVER>:8001/embed/image \
  -F "file=@test-image.jpg"
```

**Verificações**:
- [ ] Embeddings texto: 4096 dim
- [ ] Embeddings imagem: 1024 dim
- [ ] Latência <500ms

#### 3.1.3 Teste FLUX (Geração de Imagens)

```bash
curl -X POST http://<IP_GPU_SERVER>:8002/generate \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "A beautiful sunset",
    "num_inference_steps": 4
  }'
```

**Verificações**:
- [ ] Imagem gerada
- [ ] Tempo de geração <10s
- [ ] Qualidade aceitável

#### 3.1.4 Teste ASR (Transcrição)

```bash
curl -X POST http://<IP_GPU_SERVER>:8003/transcribe \
  -F "file=@test-audio.mp3"
```

**Verificações**:
- [ ] Transcrição gerada
- [ ] Tempo < tempo do áudio
- [ ] Precisão aceitável

### 3.2 Testes de Performance

**Duração**: 1 dia

#### 3.2.1 Benchmark de Latência

```bash
# Script de benchmark
for i in {1..100}; do
  time curl -s -X POST http://<IP_GPU_SERVER>:8000/v1/chat/completions \
    -H "Content-Type: application/json" \
    -d '{"model": "mixtral", "messages": [{"role": "user", "content": "Hi"}]}' \
    > /dev/null
done
```

**Métricas esperadas**:
- P50: <1ms (rede interna) ou <50ms (pública)
- P95: <5ms (rede interna) ou <100ms (pública)
- P99: <10ms (rede interna) ou <200ms (pública)

#### 3.2.2 Teste de Carga

```bash
# Usar Apache Bench ou similar
ab -n 1000 -c 10 http://<IP_GPU_SERVER>:8000/health
```

**Métricas esperadas**:
- Throughput: >100 req/s
- Erros: <1%
- Latência P95: <100ms

### 3.3 Testes de Segurança

**Duração**: 1 dia

- [ ] Firewall bloqueando acesso externo (apenas IP CX43)
- [ ] TLS configurado (se usar HTTPS)
- [ ] Dados não trafegam internet (rede interna)
- [ ] Logs não expõem informações sensíveis

---

## Fase 4: Migração (Semana 4)

### 4.1 Blue-Green Deployment

**Duração**: 1 semana

#### 4.1.1 Preparação

- [ ] Backup completo do estado atual
- [ ] Documentar configuração Salad atual
- [ ] Preparar rollback plan

#### 4.1.2 Migração Gradual

**Dia 1-2: 10% Tráfego**

1. **Configurar load balancer** (se necessário) ou feature flag
2. **Direcionar 10% do tráfego para Hetzner GPU**
3. **Monitorar métricas**:
   - Latência
   - Taxa de erro
   - Uso de GPU
   - Logs de erro

**Verificações**:
- [ ] Latência dentro do esperado
- [ ] Taxa de erro <1%
- [ ] Sem erros críticos nos logs

**Dia 3-4: 50% Tráfego**

1. **Aumentar para 50%**
2. **Monitorar por 48h**
3. **Validar métricas**

**Dia 5-7: 100% Tráfego**

1. **Migrar 100% do tráfego**
2. **Monitorar por 7 dias**
3. **Validar estabilidade**

### 4.2 Desativação Salad Cloud

**Após 7 dias de estabilidade**:

- [ ] Cancelar Container Groups Salad Cloud
- [ ] Remover secrets `SALAD_*` do GitHub
- [ ] Remover código de integração Salad (opcional)
- [ ] Atualizar documentação

---

## Fase 5: Otimização (Semanas 5-6)

### 5.1 Otimizações de Performance

- [ ] Ajustar batch sizes
- [ ] Otimizar uso de VRAM
- [ ] Configurar auto-scaling (se necessário)
- [ ] Tuning de parâmetros dos modelos

### 5.2 Monitoramento

- [ ] Dashboards Grafana para GPU
- [ ] Alertas de uso de VRAM
- [ ] Alertas de latência
- [ ] Alertas de disponibilidade

---

## Rollback Plan

### Se algo der errado:

1. **Reverter código**:
   ```bash
   git revert <commit-hash>
   git push
   ```

2. **Reverter .env.prod**:
   ```bash
   # Restaurar variáveis SALAD_*
   # Remover variáveis GPU_*
   ```

3. **Redeploy**:
   ```bash
   docker compose -f docker-compose.prod.yml up -d
   ```

4. **Reativar Salad Cloud** (se necessário):
   - Container Groups podem ser recriados manualmente
   - URLs configuradas como secrets

---

## Checklist Final

### Pré-Migração
- [ ] Servidor GPU provisionado e configurado
- [ ] Docker e NVIDIA Container Toolkit instalados
- [ ] Código atualizado (sem Salad)
- [ ] Secrets atualizados
- [ ] Testes locais passando

### Pós-Migração
- [ ] Todos os serviços GPU rodando
- [ ] Todos os serviços Alice conectados
- [ ] Testes funcionais passando
- [ ] Performance dentro do esperado
- [ ] Monitoramento configurado
- [ ] Documentação atualizada

---

**Autor:** Fillipe Guerra  
**Data:** 25 de Dezembro de 2025  
**Versão:** 1.0.0

