# Alice Enterprise Platform - STATUS REAL ATUAL

**Autor:** Fillipe Guerra  
**Data:** 11 de Março de 2026  
**Método:** Verificação direta do código-fonte + revisão sistemática completa  
**Versão:** 15.20 - Correção de CI + alinhamento de tipagem de anexos no backend (`server/routes.ts`)
**Fonte canônica de status de execução por rodada:** `docs/PLANO-EXECUCAO-CODEX-ENTERPRISE-2026-03-10.md`

---

## Atualizações executadas e precedência (11/03/2026)

- O detalhamento completo de execuções, validações e commits por rodada está no tracking canônico: `docs/PLANO-EXECUCAO-CODEX-ENTERPRISE-2026-03-10.md`.
- Este documento mantém o snapshot operacional consolidado da plataforma, sem replicar changelog extensivo por rodada.
- Em caso de divergência entre relato histórico e estado de execução governado, prevalece o tracking canônico.
- CI Build & Typecheck: ordem de build dos packages ajustada para dependências reais (`shared -> logger -> config -> database -> shared-utils`), eliminando falha TS2307 de `@alice/logger` durante build limpo.
- Security & Compliance: verificação de Express hardening/timeouts alterada para varrer `apps/*/src` por serviço (arquitetura modular com `bootstrap`/`middleware`), removendo falso negativo quando a lógica não está em `src/index.ts`.
- Backend legado (`server/routes.ts`): schema `createMessageSchema` passou a reutilizar `MessageAnexosSchema` canônico de `@alice/shared/schema`, removendo incompatibilidade de tipos de `anexos` no typecheck estrito.

## Resumo executivo

- Arquitetura multi-stack modular com 5 stacks independentes e rollback cirúrgico.
- GPU local dedicada ao LLM, embeddings e training; ASR e Vision via OpenAI.
- CI/CD 100% automático (Push → CI → Release → Deploy) com versionamento e cache enterprise.
- Observabilidade completa com Prometheus, Grafana, Loki, Jaeger e Langfuse.
- **Demo Trading enterprise** com simulação realista (Spot/Futures/Margin), balances auditáveis e dados reais de mercado.
- **Post-Mortem Auto-Motivator** automático para posições reais e demo (pipeline CPU → LLM com citedValues).
- **Dataset Generator** automático: post-mortems completos geram datasets de treinamento com status pending.
- **Snapshot Store** para evidências de mercado (entry/exit/candles/orderbook/news) em JSONB comprimido.
- **Botão "Aprovar Demo"** na aba Sinais IA permite converter sinais em ordens Demo (complementar ao "Aprovar" Real).
- **Realtime Trading/Demo**: normalização de chave de assinatura WS para Futures (`marginMode` consistente) no frontend e chat-service, eliminando mismatch de entrega de broadcast.
- **Demo Futures Lifecycle**: endpoints para ajuste de SL/TP, adição de tamanho e fechamento parcial/total, com validação robusta de proteções versus preço de entrada.
- **Demo Trading Multi-ativo**: saldos por moeda via API dedicada (`/api/integrations/demo-trading/balances`) e contabilização por ativo para Spot/Margin (compra/venda com débito/crédito correto por base/quote).
- **Venda por Ativo (Real + Demo)**: ação direta “Vender” a partir da lista de ativos para pré-preencher ticket de ordem sem retrabalho operacional.
- **Ecossistema LLM completo**: LoRA adapters globais (QLoRA) + RAG contextual + Feedback Loop automático para evolução contínua.
- **Segregação enterprise de Training/LoRA por escopo**: inferência automática de `namespace/agent/domain` em todas as fontes, quarentena automática por baixa confiança e trilha de auditoria de overrides.
- **Pipeline universal de Training (sem rota Trading separada)**: endpoint especializado `/api/training/jobs/trading` removido; criação de jobs centralizada em `/api/training/jobs` e on-demand/scheduler unificados por namespace.
- **Binding obrigatório de adapter por contexto**: resolução contextual `agent -> namespace -> base` com política estrita (`LORA_STRICT_BINDING`) em fluxos LLM de integrações e chat.
- **Governança de fallback expandida**: `llm_fallback_logs` enriquecida (serviço, chamada, motivo, namespace/agent, modelo base/resolvido, adapter encontrado), novos endpoints de eventos e clusters semânticos para ação em Namespace.
- **Trading fail-closed obrigatório**: geração de sinais/análises exige `namespace=trading` ativo, agente ativo, dataset aprovado e adapter LoRA ativo; sem fallback para modelo geral em operações de Trading.
- **Training governado por escopo**: aprovação com override controlado (motivo obrigatório), resolução manual de quarentena e seleção inteligente de exemplos por perfil semântico.
- **Observabilidade de governança de escopo**: métricas de quarentena, overrides e resolução manual publicadas no training-service para monitoramento contínuo.
- **Observabilidade LoRA no chat**: métricas `alice_chat_lora_*` integradas em dashboard LLM e alertas de erro/cache para detectar falhas de binding por escopo.
- **Hardening de isolamento de escopo**: suíte de testes unitários cobre isolamento de cache keys e nomes/caminhos de adapters por `namespace/agent` para evitar contaminação cross-scope.
- Status de Integrações no Dashboard/Integrações usa SSOT Prometheus via observability-service.
- OpenAI Vision (Responses API) exibida com status operacional na página Integrações.
- Prepare Infrastructure: preparação SSOT consolidada em sessão SSH única (menos conexões e menos timeouts).
- Página Módulos removida (UI + rotas + claims OIDC).
- Trading API: endpoints `/market`, `/klines` e `/orderbook` aceitam `symbol` via query e usam fallback de símbolo padrão quando ausente.
- Grafana: execução com `user: 472:472` para manter ownership correto em `/opt/alice/data/grafana`.
- Segurança enterprise com hardening de containers, RLS no PostgreSQL e validação Zod em APIs.
- Integração KuCoin auditada e corrigida conforme docs oficiais (auth HMAC v2/v3, time sync, stop orders, WS broadcast via Redis).
- **Order Dialog Enterprise** (Trading Demo + Trading Real): cotação ao vivo com badge “Ao Vivo”, inputs duais (quantidade e USDT com conversão automática bidirecional via contract multiplier), resumo detalhado da ordem antes de confirmar (símbolo, direção, tipo, preço, valor estimado, margem requerida, leverage, SL/TP). UX alinhada com exchanges reais (KuCoin).
- Trading UI: chamadas REST bloqueadas quando símbolo não está definido (evita 404 e tela “Algo deu errado”).
- Trading UI: histórico de ordens evita chamadas duplicadas e loop de retry ao alternar para a aba Histórico.
- Integrações UI: tipagem i18n alinhada para interpolação (build frontend sem erro TS2554).
- Trading multi‑timeframe: perfis persistidos (analysis/signal), consenso por maioria, seleção dinâmica de indicadores e fontes.
- Suporte/Resistência explícito na UI com toggle e explicação detalhada por timeframe.
- Sinais IA exibem contexto multi‑timeframe, consenso e explicações (inclui dataset pronto para aprovação).
- Sinais IA agora exibem tipo de operação, duração, TP/SL, RR, motivadores e invalidações (resumo executivo no UI).
- Análise técnica passa a retornar plano determinístico com operação, duração, TP/SL, RR e motivadores no painel.
- Geração de sinais com LLM usa orçamento seguro de tokens (prompt truncado e max_tokens ajustado ao contexto).
- Sinais com notícias: estimativa de tokens mais conservadora (regex + densidade) evita overflow de contexto.
- Trading: dados de mercado (ticker/orderbook/klines/trades) 100% real-time via WebSocket — sem polling REST (Regra 6).
- Trading: budget de prompt com margem conservadora evita erro 400 por contexto > 4096 tokens.
- Chat/Trading: WebSocket do frontend alinhado com `/ws/chat` (rota correta no chat-service).
- Trading: reparo de JSON mais robusto (aspas internas + string incompleta) evita falhas na geração de sinais.
- Sinais IA: normalização de chaves JSON do LLM (sem aspas) reduz falhas de parse.
- Sinais IA: reparo adicional para respostas YAML-like (linhas com "- key:") evita erro de parse.
- Sinais IA: reparo extra para YAML-like sem chaves (blocos key: value) garante JSON válido sem retry.
- Trading: arbitragem triangular agora suporta multi‑exchange com top 3 rotas e network fees por ativo.
- Trading: catálogo de arbitragem fornece exchanges, ativos intermediários e feePct efetivo via API KuCoin.
- Trading: UI de arbitragem com dropdown multi‑select (exchanges/ativos) + limite de 30 ativos.
- Trading: seleções múltiplas (timeframes/indicadores/técnicas/fontes) agora usam dropdown com scroll nas abas Análise e Sinais IA.
- Sinais IA: histórico inline com paginação, ordenação e filtros por data/tipo/status (validação/aprovação).
- Build Frontend: correção de referências ausentes em Sinais IA e Arbitragem evita falha no release.
- Sinais IA: correção de i18n no histórico (removida duplicidade de chaves).
- Trading: dropdown multi‑select mantém seleção aberta e salva automaticamente.
- Trading: limpar seleção permite zerar timeframes/indicadores/técnicas para reconfigurar do zero.
- Sinais IA: reparo JSON mais robusto (valores single‑quote/bare) no parser LLM.
- Trading: guarda contra símbolo inválido ao trocar marketType (evita 400 em market/klines/orderbook).
- Trading: histórico de Sinais IA e Análises agora abre detalhe completo ao clicar na linha.
- Sinais IA: resposta LLM agora é normalizada com base em análise determinística quando faltam campos críticos.
- Análises: histórico suporta marketType/marginMode (Spot/Margin) sem erro 400.
- Trading: feePct é automático (maior entre exchanges) e aplicado em análise/sinal.
- Proxy (Caddy): timeout dedicado para `/api/integrations/trading/analysis*` evita 502 em arbitragem pesada.
- API Gateway (dev): timeouts long‑running para trading/LLM alinhados com Caddy e integrations-service.
- Análise: rota `/analysis/history` não conflita com `/analysis/:symbol` (sem “history” como símbolo).
- Trading: timeout do integrations-service ajustado para 180s (reduz 502 por EOF em sinais longos).
- Trading: histórico com purge definitivo admin (limpa sinais/análises + validações e desvincula ordens/schedulers).
- Análise: guard explícito evita erro com “history” e bloqueia lista vermelha na UI.
- Presets de notícias: edição completa e salvamento ao lado de Salvar/Gerar (Análise + Sinais IA).
- Deploy: migration `0049_trading_llm_validation_details.sql` agora calcula contagem de chaves JSONB via `jsonb_object_keys` (compatível com PostgreSQL).
- Sinais IA: reparo de chaves JSON não-quotadas agora aceita qualquer key (inclui `citedValues`) e reduz falhas de parse.
- Sinais IA: diagnóstico de validações LLM usa contagem de chaves JSONB compatível com PostgreSQL.
- Observability: limites de Prometheus/ClickHouse/OTel ajustados para usar melhor CPU/RAM e evitar throttling.
- SearXNG: engines ahmia/torch removidas para eliminar ruído; Tor mantido para deep web sob demanda.
- Chat: correção do upgrade WS evita crash por double handleUpgrade.
- Timezone: configuração regional do usuário persiste no PostgreSQL e UI usa timezone do perfil (fallback America/Sao_Paulo).
- Trading: histórico de sinais evita loop de render e re-fetch contínuo em filtros/paginação.
- Observability: logs do frontend enviados com JSON válido (sendBeacon com content-type correto).
- Trading: histórico de análise evita loop de render em filtros/paginação (dedupe + guards).
- Trading: WS orderbook usa depth mínimo disponível e dedupe por sequência.
- Trading: WS ticker dedupado por assinatura (menos re-render).
- Trading: REST orderbook limitado a depth 20 (limite oficial KuCoin); WS mantém máximo 50.
- Trading: extração de JSON balanceada evita truncamento por chaves em texto.
- Trading: logging explícito de notícias confirma uso de SearXNG na análise.
- Trading: presets de notícias com CRUD (criar, editar e excluir) direto nas abas Análise e Sinais IA.
- Chat: headers SSE enviados antes de qualquer `res.write` (corrige ERR_HTTP_HEADERS_SENT no modo agentic).
- Proxy (Caddy): timeouts dedicados para `/api/chat/stream` e `signals/generate` evitam 502 em LLM lento.
- Trading: notícias usadas exibidas na Análise (consulta + links) quando habilitado.
- Trading: detalhes do Sinal IA agora exibem notícias usadas na geração quando habilitado.
- Sinais IA: parsing robusto de JSON do LLM com reparo seguro e prompt de saída estrito.
- Roteamento de agentes: gatilhos configuráveis no Modo Agentic (manual/auto) por tenant.
- Chat: seleção manual de agentes no UI com persistência por conversa e envio no stream.
- Roteamento agentic: normalização de comandos (acentos/@) e detecção consistente no WebSocket.
- Roteamento stream: validação defensiva do insert do assistente evita messageId indefinido.
- LLM Trading: erros de validação sem duplicação de prefixo (mensagem mais limpa).
- Roteamento WS: comando manual aparece no chat sem refresh.
- LLM Trading: mensagens pós-reparo sem duplicação de prefixo.
- Roteamento manual: match de agentes evita falsos positivos por substring.
- Roteamento manual: slugs normalizados vazios são ignorados no lookup.
- Notícias Trading: configuração de termos/engines do SearXNG persistida em perfil e editável na UI (Sinais + Análise).
- RAG Web Search: suporte a engines, categorias, idioma e SafeSearch por requisição (integração SearXNG ajustável).
- Presets de notícias: presets principais salvos no banco e aplicáveis no perfil de Sinais/Análise.
- Notícias Trading: time range configurável (day/week/month/year) e datas opcionais em templates.
- Notícias Trading: seleção rápida para última hora/24h e modo personalizado.
- Notícias Trading: normalização de templates evita array vazio e crash em runtime.
- Training: datasets de trading com aprovação dedicada e fluxo manual via sinal → dataset.
- Trading: correção da ordem de hooks para evitar React error #310 na página de Trading.
- Modo Agentic: criação de `conversation_states` agora é UPSERT idempotente (elimina erro 23505).
- Chat streaming: resposta de erro clara quando falha antes de enviar headers (evita 502 silencioso).
- Agentic settings: detectores default persistidos quando `detectors` está vazio no banco.
- LLM Trading: normalização de campos numéricos e arrays reduz falhas de parse e validação.
- Training: webhook com deduplicação semântica (semhash + cosine) e auditoria de duplicados.
- CI: reordenação de enums/schemas de trading evita uso antes da declaração.
- Lint: remoção de import não usado na página Trading (zero warnings).
- Trading Chart: novo renderer com lightweight-charts (visual moderno e performance).
- Trading multi‑market: favoritos/destaques por usuário, pares em destaque no seletor e troca de símbolo no gráfico.
- Trading Chart: timeframes responsivos sem overflow horizontal e gráfico com layout estável (sem distorção).
- Trading Chart: troca de intervalo limpa klines e recarrega histórico via REST (dados real-time via WS, sem polling).
- SearXNG News: integração corrigida com headers internos assinados (401 removido em Sinais IA e Análise).
- Trading Risk Config: normalização de valores decimais (vírgula → ponto) e payload consistente para evitar erro "Dados inválidos" ao salvar.
- Agentic Trading: prompts com exemplos e boas práticas no Modo Agentic; parser de chat agora reconhece análise técnica e sinais IA com timeframes e fontes de dados.
- Trading UI: painéis de Sinais IA e Análise unificados (perfil + execução + scheduler) e scheduler usa timeframes do perfil multi-timeframe.
- KuCoin rate limit: retry/backoff respeita `Retry-After` e `gw-ratelimit-reset` (ms) conforme docs oficiais.
- Deploy: migration `0043_trading_symbol_preferences.sql` deve ser aplicada no próximo deploy.
- Trading i18n: chaves de `trading.symbols` alinhadas entre PT-BR e EN (labels corretos no seletor).

---

## Visão geral da plataforma

- Arquitetura: Multi-Stack Modular (5 stacks independentes).
- Servidor: Hetzner GEX44 (Intel Core i5-13500 14 Core, 64GB DDR4 RAM, 2x 1.92TB NVMe SSD RAID 1, RTX 4000 Ada 20GB).
- SO: Ubuntu 24.04.3 LTS.
- Docker: 29.1.3 + Compose v5.0.0.
- Domínio: yesyoudeserve.duckdns.org.
- IP produção: 178.63.41.108.
- LLM (texto): Qwen2.5 7B Instruct (AWQ) via GPU Manager.
- Vision (análise de imagens): OpenAI Responses API (`gpt-4.1`).
- Geração de imagens: OpenAI Images API (`gpt-image-1`).
- Storage: Volume local Hetzner (sem S3 externo).

---

## Arquitetura Gate 2 (GPU + OpenAI)

- GPU local: LLM (texto) e embeddings (texto) always-on; training sob demanda.
- Vision e geração de imagens: OpenAI (sem VLM local).
- GPU Manager Service: fila priorizada, monitoramento VRAM, circuit breakers e métricas Prometheus.
- Budget VRAM: 20GB com serviços simultâneos.

---

## Stacks e serviços

### Stack INFRA

- PostgreSQL 16 + pgvector.
- PgBouncer.
- Redis (cache).
- Qdrant (texto 1024 dim).
- Caddy (API Gateway + SSL + HTTP/3).
- MinIO (S3 interno para Langfuse).
- SearXNG + Tor (JSON habilitado para integração Agentic).

### Stack ALICE

- Frontend (React + Vite).
- Auth Service (OAuth, SAML, OIDC).
- Biometrics Service (login/enroll/verify).
- Chat Service (WebSocket + streaming LLM).
- LLM Gateway Service (rota/contexto namespace/agente; opcional quando `LLM_GATEWAY_URL` configurado).
- RAG Service (pgvector + embeddings).
- Training Service (auto-learning + fine-tuning).
- Integrations Service (Stripe, Wise, Twilio, Gmail SMTP, KuCoin, OpenAI Vision status).
- Observability Service (health + backups).
- GPU Manager Service.

### Stack GPU (local)

- `gpu-llm`: Qwen2.5 7B (vLLM).
- `gpu-embeddings`: Qwen3-Embedding-0.6B INT8 (texto).
- `gpu-trainer`: QLoRA sob demanda (profile).

### Stack OBSERVABILITY

- Prometheus, Grafana (Alerting), Loki, Jaeger, Langfuse, ClickHouse, OTel Collector, Vector, Node Exporter, cAdvisor.



### Stack BACKUP

- pgBackRest (PITR, incremental, AES-256).
- pgBackRest Exporter (métricas Prometheus porta 9854).

---

## Serviços Alice (apps/)

- `frontend-service`: React 19 + Vite 7.3 + i18n PT-BR/EN.
- `auth-service`: OAuth 2.0, SAML 2.0, OIDC Provider, RBAC 6 níveis, sessões PostgreSQL.
- `biometrics-service`: biometria (login, enroll, verify).
- `chat-service`: WebSocket, streaming LLM, RAG client, takeover/handover, comandos de trading.
- `llm-gateway-service`: gateway LLM (resolução rota/contexto namespace/agente; chat e integrations podem usar quando `LLM_GATEWAY_URL` configurado).
- `rag-service`: upload multimodal, embeddings texto GPU, fila assíncrona, WebSocket de embeddings.
- `training-service`: scheduler, fine-tuning QLoRA, SemHash.
- `observability-service`: health checker, backup orchestrator, métricas.
- `api-gateway` Node.js: apenas dev local (Caddy em produção).

---

## Banco de dados (PostgreSQL 16 + pgvector)

### Schema Core

- `sessions`, `tenants`, `users`, `permissions`, `role_permissions`, `oauth_clients`, `oauth_authorization_codes`, `oauth_tokens`, `oidc_payloads`, `oidc_jwks`, `feature_flags`, `assistant_settings`.

### Schema Chat

- `conversations`, `messages`, `conversation_states`, `conversation_participants`, `conversation_escalations`.

### Schema RAG

- `namespaces`, `agents`, `documents`, `document_chunks`.

### Schema Training

- `training_data`, `fine_tuning_jobs`, `model_versions`, `auto_learning_schedule`.

### Schema Integrations


### Schema Media

- `generated_images`, `media_uploads`.

### Schema Trading

- `trading_signals`, `trading_orders`, `trading_positions`, `trading_risk_config`, `trading_audit_log`, `trading_market_data`, `trading_dataset`, `lora_jobs`.

### Schema Demo Trading + Post-Mortem (migration 0056)

- `demo_balances` — saldo simulado por tenant (USDT, auditável).
- `demo_fund_history` — histórico de adição de fundos e créditos/débitos de PnL.
- `demo_orders` — ordens simuladas (market/limit/stop) com metadata JSONB (SL/TP).
- `demo_positions` — posições demo com margem, leverage e PnL calculado.
- `trading_snapshots` — snapshots de mercado (kinds: market_entry, market_exit, candles, orderbook_top, news, evidence_pack) com dados comprimidos.
- `trading_postmortems` — análises pós-fechamento com classificação CPU + motivadores LLM, fingerprint idempotente.
- `trading_dataset` — datasets gerados a partir de post-mortems completos, com status 'pending' para aprovação.

---

## Demo Trading

- **Mercados suportados**: Spot, Futures (com leverage), Margin.
- **Execução simulada** usando dados reais de mercado via KuCoin API.
- **Fees realistas**: maker 0.02%, taker 0.06%, slippage 3 bps.
- **Balances auditáveis**: histórico completo de adição de fundos e PnL.
- **Scheduler automático**: verifica ordens limit/stop e posições para auto-close (SL/TP/liquidação).
- **Integração Post-Mortem**: toda posição fechada gera post-mortem automaticamente.
- **Frontend**: página `/demo-trading` com abas (Visão Geral, Ordens, Posições, Histórico, Post-Mortems).
- **Sinais IA**: botão "Aprovar Demo" na aba Sinais IA converte sinal em ordem Demo.

## Post-Mortem Auto-Motivator

- **Trigger automático**: executa no fechamento de TODA posição (real e demo).
- **Pipeline two-phase**:
  - Phase 1 (CPU): classificação determinística — tradeStyle, archetype, strategy, techniqueScores, evidence pack.
  - Phase 2 (LLM): motivadores explicativos com citedValues, fatores de sucesso/falha, lições aprendidas.
- **Idempotência**: fingerprint SHA-256 de positionId + timestamps + fillsHash + engineVersions.
- **Fila Redis**: Sorted Set com retry exponencial (3 tentativas), DLQ para falhas persistentes.
- **Quotas**: limites diários de chamadas LLM por tenant (Phase 2).
- **Métricas Prometheus**: `alice_postmortem_jobs_total`, `alice_postmortem_job_duration_seconds`, `alice_postmortem_queue_size`, `alice_postmortem_dlq_size`.

## Dataset Generator

- Geração automática de datasets de treinamento a partir de post-mortems completos (status=completed + snapshots).
- Schema padronizado: marketContext, tradeExecution, autoAnnotation, prompt (system + user), expected response.
- Datasets criados com status 'pending' para aprovação manual na página Training.
- sourceType: 'postmortem' com sourceMetadata detalhado (isDemo, fingerprint, engineVersions).

## Ecossistema LLM (LoRA + RAG + Feedback Loop)

- **LoRA Adapters Globais**: Adapter trading único (`trading-global`) treinado via QLoRA, compartilhado entre tenants.
  - Ativação automática após aprovação de job de treinamento.
  - vLLM v0.12.0+ com suporte AWQ + LoRA (`--enable-lora`, `--max-lora-rank 16`).
  - Adapter armazenado em `/opt/alice/data/lora-adapters/trading-global` (volume Docker read-only).
  - Cache Redis com TTL 60s para resolver modelo com/sem adapter ativo.
  - Fallback para modelo base (`Qwen/Qwen2.5-7B-Instruct-AWQ`) quando adapter não disponível.
- **RAG Contextual para Trading**: Busca semântica em documentos de estratégia e learnings anteriores.
  - Enriquece geração de sinais IA com contexto de namespace do agente trading.
  - Enriquece post-mortem Phase 2 com learnings de trades similares.
  - Threshold de similaridade 0.6, máximo 3 documentos por query.
  - Non-blocking: falha no RAG não bloqueia geração de sinal nem post-mortem.
- **Feedback Loop Automático**: Post-mortems completos são indexados automaticamente no namespace RAG.
  - Documento estruturado com motivadores, lições, fatores de sucesso/falha.
  - Dedup por source (`postmortem:{id}`), 409 tratado como sucesso.
  - Futuras gerações de sinais e post-mortems se beneficiam dos learnings acumulados.
- **Métricas Prometheus**:
  - `alice_lora_resolve_total{result}`: resoluções de modelo (adapter/base/error).
  - `alice_lora_resolve_duration_seconds`: latência de resolução.
  - `alice_lora_cache_total{status}`: cache Redis hit/miss/error.
  - `alice_trading_rag_query_total{type,result}`: consultas RAG (signal/postmortem).
  - `alice_trading_rag_query_duration_seconds{type}`: latência de consultas RAG.
  - `alice_trading_rag_index_total{result}`: indexação de learnings (success/error).
- **API Training Service**:
  - `POST /api/training/lora/activate/:jobId`: ativa adapter de job treinado.
  - `GET /api/training/lora/active`: consulta adapter ativo.
  - `DELETE /api/training/lora/active`: desativa adapter ativo.
- **Dashboard Grafana**: Painéis no Trading Dashboard para LoRA (resolução, latência, cache) e RAG (consultas, feedback loop).

## Snapshot Store

- **Tabela**: `trading_snapshots` com JSONB comprimido via TOAST automático do PostgreSQL.
- **Kinds suportados**: `market_entry`, `market_exit`, `candles`, `orderbook_top`, `news`, `evidence_pack`.
- **Captura automática**: `captureEntrySnapshot()` na abertura e `captureExitSnapshot()` no fechamento.
- **Dados capturados**: ticker (preço, bid/ask, volume), orderbook top (bids/asks), candles recentes (1m, 3m, 5m, 15m, 1h).
- **Referências**: posições demo e reais mantêm `entrySnapshotId` e `exitSnapshotId` para rastreabilidade.

## API Endpoints — Demo Trading + Post-Mortem

### Demo Trading (integrations-service)

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| `GET` | `/api/integrations/demo-trading/balance` | Balance atual do tenant |
| `POST` | `/api/integrations/demo-trading/funds` | Adicionar fundos auditáveis |
| `GET` | `/api/integrations/demo-trading/funds/history` | Histórico de movimentações |
| `POST` | `/api/integrations/demo-trading/orders` | Criar ordem (market/limit/stop) |
| `POST` | `/api/integrations/demo-trading/orders/from-signal` | Criar ordem a partir de sinal IA |
| `GET` | `/api/integrations/demo-trading/orders` | Listar ordens |
| `DELETE` | `/api/integrations/demo-trading/orders/:id` | Cancelar ordem pendente |
| `GET` | `/api/integrations/demo-trading/positions` | Listar posições |
| `POST` | `/api/integrations/demo-trading/positions/:id/close` | Fechar posição |

### Post-Mortem (integrations-service)

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| `GET` | `/api/integrations/postmortem/:positionId` | Post-mortem por posição |
| `GET` | `/api/integrations/postmortem` | Listar post-mortems (filtro `isDemo`) |
| `GET` | `/api/integrations/postmortem/queue/stats` | Estatísticas da fila Redis |
| `POST` | `/api/integrations/postmortem/queue/retry/:jobId` | Reprocessar job da DLQ |
| `GET` | `/api/integrations/postmortem/snapshots/:positionId` | Snapshots de uma posição |
| `POST` | `/api/integrations/postmortem/send-to-training` | Enviar post-mortem para dataset |
| `POST` | `/api/integrations/postmortem/send-to-training/batch` | Enviar batch para dataset |

### Sinais IA (integrations-service)

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| `POST` | `/api/integrations/trading/signals/generate` | Gerar sinal via LLM (com RAG + LoRA) |
| `GET` | `/api/integrations/trading/signals` | Sinais pendentes |
| `POST` | `/api/integrations/trading/signals/:id/approve` | Aprovar sinal (ordem real) |
| `POST` | `/api/integrations/trading/signals/:id/reject` | Rejeitar sinal |
| `GET` | `/api/integrations/trading/signals/history` | Histórico de sinais |
| `POST` | `/api/integrations/trading/datasets/from-signal` | Criar dataset a partir de sinal |

### LoRA Adapter Management (training-service)

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| `POST` | `/api/training/lora/activate/:jobId` | Ativar adapter de job concluído |
| `GET` | `/api/training/lora/active` | Consultar adapter ativo |
| `DELETE` | `/api/training/lora/active` | Desativar adapter ativo |

---

## Observabilidade

- Prometheus 3.8.1 e Grafana 12.3.2 com Grafana Alerting (Alertmanager removido).
- Dashboards principais: Home, Services, LLM Metrics, RAG Metrics, Integrations, Infrastructure, Training, Training Pipeline, Backup, **Demo Trading + Post-Mortem**, **LoRA + RAG Ecosystem**.
- Dashboard Demo Trading: ordens por tipo de mercado, posições profit/loss, fila post-mortem, DLQ, latência P50/P95/P99.
- Loki/Promtail 3.6.3 e Jaeger 2.13.0 (OTLP habilitado).
- Langfuse v3 com worker e ClickHouse 25.12-alpine.

---

## CI/CD

- Pipeline: Push → CI → Release → Deploy.
- Workflows: `ci.yml`, `release.yml`, `deploy-stack-modular.yml`.
- Funções compartilhadas: `scripts/release-functions.sh` (build/retag) e `infra/scripts/deploy-functions.sh` (pull/credentials) — CLAUDE.md Regra 2.
- CI valida todos os 8 microsserviços Node.js incluindo gpu-manager-service (express hardening + server timeouts).
- Release: 16 imagens Docker (13 microservices + 3 GPU), build condicional com retag inteligente, smoke test PostgreSQL + pgvector com trap cleanup.
- Deploy: Smart Pull com `pull_if_needed()` centralizada e `pull_with_retry()` consistente (5 tentativas, backoff progressivo 15/30/60/90/120s; Redis com connectTimeout 10s e 10 tentativas de reconexão — 11/02/2026).
- Cache enterprise: BuildKit/registry cache, pnpm cache e pip cache.
- Rollback cirúrgico por stack.
- Versionamento semântico automático via Conventional Commits.

---

## Segurança

- Hardening de containers: `no-new-privileges`, `read_only` quando aplicável, limits em 100% dos serviços.
- Validação Zod em endpoints e parâmetros críticos.
- RLS aplicado nas tabelas de trading.
- Secrets obrigatórios validados no deploy (fail-fast).
- TLS automático via Caddy (ZeroSSL primário + Let's Encrypt fallback).

---

## Capacidades de IA

- Chat e trading via LLM local (Qwen2.5 7B AWQ).
- Vision e geração de imagens via OpenAI (gpt-4.1 / gpt-image-1).
- Embeddings texto: Qwen3-Embedding-0.6B INT8 (1024 dim) → Qdrant.
- Imagem: OpenAI Vision (descrição textual, sem embeddings de imagem).
- ASR: OpenAI gpt-4o-transcribe.
- Busca de imagens na web via SearXNG (sem embeddings de imagem; armazenamento no RAG com descrição textual).

---

## Limites de mídia e compatibilidade OpenAI

- Upload de imagem (RAG/chat): **10 MB** por arquivo.
- Upload de áudio (ASR): **25 MB** por arquivo.
- Upload de documento (RAG): **50 MB** por arquivo.
- Busca de imagens web (download externo): **8 MB** por imagem.
- OpenAI Vision (gpt-4.1): aceita até **50 MB** de payload total por request (limite interno é 10 MB por imagem).
- OpenAI ASR (gpt-4o-transcribe): **25 MB** por arquivo (limite interno alinhado).
- Geração de imagens (gpt-image-1): prompt textual (sem imagem de entrada). Saída armazenada no RAG com anexos e descrição via Vision.

---

## Backups

- PostgreSQL: pgBackRest (full + incremental + WAL).
- Redis: RDB snapshots.
- Manifestos JSON por job.

### Schedule padrão

```text
Full Backup:        0 3 * * 0
Incremental Backup: 0 3 * * 1-6
Retenção Full:      15 dias
Retenção Incremental: 7 dias
Retenção Arquivo:   30 dias
```

---

## Atualizações recentes (resumo)

- O resumo detalhado de alterações por rodada foi consolidado no tracking canônico para reduzir duplicidade documental.
- Consultar `docs/PLANO-EXECUCAO-CODEX-ENTERPRISE-2026-03-10.md` para histórico completo de implementação, validações e commits.

## Tuning seguro (aplicação + servidor)

### Flags de aplicação (defaults atuais)

#### Chat Service (tokens + histórico)

- `LLM_MIN_OUTPUT_TOKENS=256`
- `LLM_DYNAMIC_PROMPT_T1=1600`
- `LLM_DYNAMIC_PROMPT_T2=2200`
- `LLM_DYNAMIC_PROMPT_T3=2800`
- `LLM_DYNAMIC_PROMPT_T4=3600`
- `LLM_DYNAMIC_MAX_TOKENS_T1=1536`
- `LLM_DYNAMIC_MAX_TOKENS_T2=1024`
- `LLM_DYNAMIC_MAX_TOKENS_T3=768`
- `LLM_DYNAMIC_MAX_TOKENS_T4=512`
- `CHAT_HISTORY_FETCH_LIMIT=10`
- `CHAT_HISTORY_ALWAYS_INCLUDE_TRADING=6`
- `CHAT_HISTORY_ALWAYS_INCLUDE_GENERAL=4`
- `CHAT_HISTORY_MIN_MESSAGES_TRADING=0`
- `CHAT_HISTORY_MIN_MESSAGES_GENERAL=0`
- `CHAT_HISTORY_RELEVANCE_THRESHOLD_TRADING=0.08`
- `CHAT_HISTORY_RELEVANCE_THRESHOLD_GENERAL=0.12`
- `CHAT_HISTORY_FALLBACK_ENABLED=false`
- `CHAT_HISTORY_SEARCH_LIMIT=200`
- `CHAT_HISTORY_SEARCH_TOKEN_BUDGET=1200`
- `CHAT_HISTORY_SEARCH_CONVERSATIONS_LIMIT=20`
- `CHAT_MEMORY_RELEVANCE_THRESHOLD=0.10`

#### RAG Service (Top-K adaptativo)

- `RAG_ADAPTIVE_K_ENABLED=false`
- `RAG_ADAPTIVE_K_MIN_RESULTS=2`
- `RAG_ADAPTIVE_K_MIN_THRESHOLD=0.55`
- `RAG_ADAPTIVE_K_FALLBACK_DELTA=0.10`
- `RAG_ADAPTIVE_K_SHORT_QUERY=200`
- `RAG_ADAPTIVE_K_MEDIUM_QUERY=600`

#### GPU Client (timeouts/retries)

- `GPU_REQUEST_TIMEOUT_MS=60000`
- `GPU_REQUEST_MAX_RETRIES=3`
- `GPU_REQUEST_FETCH_TIMEOUT_MS=30000`
- `GPU_REQUEST_POLL_INTERVAL_MS=500`
- `GPU_REQUEST_POLL_FETCH_TIMEOUT_MS=5000`

### Tuning de servidor (manual, sem pipeline)

#### sysctl (arquivo `/etc/sysctl.d/99-alice.conf`)

- `vm.swappiness=10`
- `vm.overcommit_memory=1`
- `fs.file-max=2097152`
- `fs.inotify.max_user_watches=524288`
- `net.core.rmem_max=16777216`
- `net.core.wmem_max=16777216`

#### limits (arquivo `/etc/security/limits.d/99-alice.conf`)

- `* soft nofile 1048576`
- `* hard nofile 1048576`
- `* soft nproc 65535`
- `* hard nproc 65535`

#### Docker runtime (arquivo `/etc/docker/daemon.json`)

- `log-driver: json-file`
- `log-opts: { max-size: "100m", max-file: "5" }`
- `max-concurrent-downloads: 3` (overlay GHCR — aderência Docker docs, reduz timeouts)
- `max-download-attempts: 10` (overlay — resilência pulls lentos)
- `max-concurrent-uploads: 10`
- `live-restore: true`

Overlay aplicado idempotentemente pelo job `prepare` via `infra/scripts/daemon-registry-overlay.json` (merge sem sobrescrever configs existentes).

#### GPU runtime (manual)

- `nvidia-persistenced` habilitado
- runtime NVIDIA configurado como padrão
- CDI NVIDIA ativo (`/etc/cdi/nvidia.yaml`)

#### Storage/IO (manual)

- Limpeza segura de logs antigos em `/opt/alice/logs/`
- Remoção de volumes órfãos (`docker volume prune`) sob janela de manutenção

---

## Qualidade e conformidade

- TypeScript strict e ESLint 9 com zero warnings.
- Vitest com suite de testes atualizada para Gate 2.
- Observância às 18 regras do `CLAUDE.md`.
- Princípios 12-Factor App atendidos.

---

## Backlog (não bloqueante)

- Cobertura de testes 80%.
- Documentação OpenAPI ampliada para endpoints restantes.

---

## Changelog recente

### v10.93 - 08 de Fevereiro de 2026

**pgBackRest Exporter Unhealthy - 3 Causas Raiz**

Container `alice-pgbackrest-exporter` unhealthy (FailingStreak 4863, falhando desde deploy).

- **Causa raiz #1 - CIPHER PASS faltando**: Exporter executava `pgbackrest info --output=json` mas NÃO tinha variável `PGBACKREST_REPO1_CIPHER_PASS`. Repositório usa criptografia AES-256-CBC; sem a cipher pass, o comando falha com exit status 37 "info command requires option: repo1-cipher-pass". **Solução**: adicionadas `PGBACKREST_REPO1_CIPHER_TYPE` e `PGBACKREST_REPO1_CIPHER_PASS` (mesma variável `${BACKUP_CIPHER_PASS}` do container pgbackrest).
- **Causa raiz #2 - Hex errado no healthcheck**: Comentário e healthcheck usavam `0x268E` (= 9870 decimal) mas porta real é 9854 (= `0x267E`). `grep` nunca encontrava match. **Solução**: corrigido de `:268E` para `:267E`.
- **Causa raiz #3 - IPv6 only**: Exporter escuta em IPv6 (`/proc/net/tcp6`) mas healthcheck verificava apenas IPv4 (`/proc/net/tcp`). **Solução**: healthcheck verifica ambos `/proc/net/tcp` e `/proc/net/tcp6` com fallback.

Diagnóstico via SSH em produção (`docker inspect`, logs, env vars, `/proc/net/tcp`, `/proc/net/tcp6`, `pgbackrest info`).

**Arquivos modificados:** `infra/docker/stacks/docker-compose.backup.yml` (environment + healthcheck), `docs/ARQUITETURA.md`, `docs/STATUS-REAL-ATUAL.md`.

---

## Referências internas

- `docs/ARQUITETURA.md`
- `docs/ARQUITETURA-GPU-MANAGER.md`
- `docs/DEPLOYMENT.md`
- `docs/OBSERVABILITY.md`
- `docs/SECRETS.md`
