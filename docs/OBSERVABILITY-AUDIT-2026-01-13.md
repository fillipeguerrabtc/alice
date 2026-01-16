# Auditoria de Observabilidade - Alice Enterprise Platform (2026-01-13)

> **Autor:** Fillipe Guerra  
> **Data:** 13 de Janeiro de 2026  
> **Escopo:** Observabilidade (Prometheus, Grafana, Loki/Promtail, alertas) em produção — Arquitetura Multi-Stack  
> **Objetivo:** Garantir observabilidade enterprise-grade para todos os stacks (INFRA, ALICE, OBSERVABILITY, ERPNEXT, BACKUP) + host de produção + deploy server.

---

## Contexto

Esta auditoria foi executada para eliminar pontos cegos operacionais e reduzir MTTR, seguindo melhores práticas 2025/2026:

- **Golden Signals (SRE)**: Latência, Tráfego, Erros, Saturação
- **Dashboards por domínio/persona**: SRE/Dev/Business
- **Prometheus naming conventions**: métricas estáveis e legíveis
- **Grafana Alerting**: alertas padronizados por domínio

---

## Fonte de verdade (SSOT)

- **Prometheus (produção)**: `infra/observability/prometheus.yml`
- **Dashboards (SSOT)**: `apps/observability-service/config/grafana/dashboards/*.json`
- **Provisionamento (produção)**: `infra/observability/grafana/provisioning/dashboards/*`
- **Promtail**: `infra/observability/promtail/config.yml`

---

## Achados (Findings)

### F1 — Targets Prometheus incompletos (GPU Manager + GPU Services)

- **Problema**: Prometheus não coletava GPU Manager (`3010`) e/ou GPU services (`8000+`).
- **Impacto**: Sem visibilidade de VRAM (20GB), filas, circuit breakers e latência end-to-end.
- **Correção aplicada**:
  - Jobs/targets adicionados/alinhados em `infra/observability/prometheus.yml`:
    - `alice-services` (auth/chat/rag/training/integrations/gpu-manager)
    - `alice-gpu-services` (gpu-llm/gpu-embeddings/gpu-asr)

### F2 — Dashboards acoplados a nomes de modelos (não “capability-based”)

- **Problema**: Painéis e descrições citavam modelos específicos (“Mixtral/Qwen…”) em texto e/ou legendas.
- **Impacto**: Mudança de modelos (Gate 2 / WS3) quebrava entendimento operacional e causava confusão.
- **Correção aplicada**:
  - Dashboards revisados para serem **modelo-agnósticos** e orientados a **capabilidades** (LLM/Embeddings/ASR).

### F3 — Ausência de dashboard de Trading (KuCoin Futures)

- **Problema**: Não havia dashboard dedicado para Trading (P&L, ordens, sinais, breaker KuCoin).
- **Impacto**: Impossível operar trading em produção com segurança (sem telemetria).
- **Correção aplicada**:
  - Dashboard de Trading provisionado (UID/estrutura conforme stack).

### F4 — Dashboard LLM/Chat incompleto (WebSocket + Response Cache)

- **Problema**: Falta de painéis para WebSocket/streaming e Response Cache (Greetings Gate).
- **Impacto**: Sem visibilidade do custo/benefício (economia de GPU) e saúde do canal realtime.
- **Correção aplicada**:
  - Painéis adicionais para tokens, TTFT, WS connections, cache hit rate, erros.

### F5 — Ausência de dashboard ERPNext (workers/queues/MariaDB/Redis)

- **Problema**: Stack ERPNext sem painel consolidado.
- **Impacto**: Baixa observabilidade para “ERP lento” (fila, workers, DB).
- **Correção aplicada**:
  - Dashboard ERPNext provisionado (workers status, queue depth, MariaDB/Redis).

### F6 — “No data”: logs vazios no Loki / painéis sem séries

- **Problema**: Promtail coletava apenas `/var/log/*log` e não coletava logs reais de containers (driver `json-file`).
- **Impacto**: Loki sem dados → troubleshooting de produção comprometido.
- **Causa raiz**:
  - Falta de scrape para `/var/lib/docker/containers/*/*-json.log` e falta de mount do diretório no container do Promtail.
- **Correção aplicada**:
  - `infra/observability/promtail/config.yml`: adicionado job `docker-containers` com pipeline `docker` + `json`
  - `infra/docker/stacks/docker-compose.observability.yml`: mount read-only de `/var/lib/docker/containers`

---

## Checklist de validação (pós-deploy)

### Prometheus

- Abrir `/targets` e validar que:
  - `alice-services` está UP (auth/chat/rag/training/integrations/gpu-manager)
  - `alice-gpu-services` está UP (gpu-llm/gpu-embeddings/gpu-asr)
  - `node-exporter` e `cadvisor` do host estão UP
  - `node-exporter-deploy` e `cadvisor-deploy` do deploy server estão UP

### Grafana

- Confirmar provisionamento:
  - Home/Portal
  - LLM/Chat
  - GPU Manager
  - Trading
  - RAG
  - Training
  - ERPNext
  - Infra/Host
- Validar que painéis não dependem de nomes de modelos (apenas **capabilities**).

### Loki/Promtail

- Confirmar que Promtail está enviando logs:
  - Loki recebe streams do job `docker-containers`
  - Logs de serviços Node (Pino JSON) aparecem com parsing consistente

### Alertas (Grafana Alerting)

- Confirmar regras por domínio:
  - LLM error rate / latency / breaker open
  - KuCoin breaker open / latency P95
  - GPU VRAM high / queue deep
  - Infra (CPU/RAM/Disk/container down)

---

## Notas de segurança

- **Sem Docker socket** para Promtail: reduz superfície de ataque (evita acesso root ao daemon).
- **Scrape do deploy server**: deve ser exposto apenas via allowlist no firewall/ufw/nftables.

---

## Referências oficiais

- Grafana dashboards best practices: `https://grafana.com/docs/grafana/latest/dashboards/build-dashboards/best-practices/`
- Prometheus naming conventions: `https://prometheus.io/docs/practices/naming/`
- Promtail docker stage: `https://grafana.com/docs/loki/latest/send-data/promtail/stages/docker/`

