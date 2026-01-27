# Alice Enterprise Platform - STATUS REAL ATUAL

**Autor:** Fillipe Guerra  
**Data:** 27 de Janeiro de 2026  
**Método:** Verificação direta do código-fonte + revisão sistemática completa  
**Versão:** 10.2 - Timezone enterprise (UTC + UI Brasil)

---

## Resumo executivo

- Arquitetura multi-stack modular com 5 stacks independentes e rollback cirúrgico.
- GPU local dedicada ao LLM, embeddings e training; ASR e Vision via OpenAI.
- CI/CD 100% automático (Push → CI → Release → Deploy) com versionamento e cache enterprise.
- Observabilidade completa com Prometheus, Grafana, Loki, Jaeger e Langfuse.
- Segurança enterprise com hardening de containers, RLS no PostgreSQL e validação Zod em APIs.
- Integração KuCoin auditada e corrigida conforme docs oficiais (auth HMAC v2/v3, time sync, stop orders, WS broadcast via Redis).

---

## Visão geral da plataforma

- Arquitetura: Multi-Stack Modular (5 stacks independentes).
- Total de containers: 49 (10 infra + 8 Alice + 2 GPU + 13 observability + 15 ERPNext + 1 backup) + 1 trainer sob demanda.
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
- Chat Service (WebSocket + streaming LLM).
- RAG Service (pgvector + embeddings).
- Training Service (auto-learning + fine-tuning).
- Integrations Service (Stripe, Wise, Twilio, Gmail SMTP, KuCoin).
- Observability Service (health + backups).
- GPU Manager Service.

### Stack GPU (local)

- `gpu-llm`: Qwen2.5 7B (vLLM).
- `gpu-embeddings`: Qwen3-Embedding-0.6B INT8 (texto).
- `gpu-trainer`: QLoRA sob demanda (profile).

### Stack OBSERVABILITY

- Prometheus, Grafana (Alerting), Loki, Jaeger, Langfuse, ClickHouse, OTel Collector, Vector, Node Exporter, cAdvisor.

### Stack ERPNEXT

- MariaDB, Redis Cache/Queue, backend, websocket, scheduler e workers.

### Stack BACKUP

- pgBackRest (PITR, incremental, AES-256).

---

## Serviços Alice (apps/)

- `frontend-service`: React 19 + Vite 7.3 + i18n PT-BR/EN.
- `auth-service`: OAuth 2.0, SAML 2.0, OIDC Provider, RBAC 6 níveis, sessões PostgreSQL.
- `chat-service`: WebSocket, streaming LLM, RAG client, takeover/handover, comandos de trading.
- `rag-service`: upload multimodal, embeddings texto GPU, fila assíncrona, WebSocket de embeddings.
- `training-service`: scheduler, fine-tuning QLoRA, SemHash.
- `integrations-service`: Stripe/Wise/Twilio/ERPNext/KuCoin + circuit breakers.
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

- `integrations`, `audit_logs`, `webhook_events`, `stripe_erpnext_mapping`, `wise_sync_log`, `backup_jobs`.

### Schema Media

- `generated_images`, `media_uploads`.

### Schema Trading

- `trading_signals`, `trading_orders`, `trading_positions`, `trading_risk_config`, `trading_audit_log`, `trading_market_data`, `trading_dataset`, `trading_lora_jobs`.

---

## Observabilidade

- Prometheus 3.8.1 e Grafana 12.3.1 com Grafana Alerting (Alertmanager removido).
- Dashboards principais: Home, Services, LLM Metrics, RAG Metrics, Integrations, Infrastructure, Training, Backup.
- Loki/Promtail 3.6.3 e Jaeger 2.13.0 (OTLP habilitado).
- Langfuse v3 com worker e ClickHouse 25.12-alpine.

---

## CI/CD

- Pipeline: Push → CI → Release → Deploy.
- Workflows: `ci.yml`, `release.yml`, `deploy-stack-modular.yml`.
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
- MariaDB: Mariabackup.
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

- Agentic: detectores configuráveis por tenant (keywords/regex) no Modo Agentic.
- ASR: normalização de MIME para evitar erro `unsupported_format` em `audio/webm;codecs=opus`.
- ASR: gravação converte áudio para WAV quando formato não é aceito pelo OpenAI.
- ASR: retry automático sem stream quando OpenAI falha com stream (transcrição estável).
- Vision: logs detalhados de erro da OpenAI para diagnóstico preciso.
- Imagens: mensagens recuperam imagens geradas via metadata (evita mensagem vazia no chat).
- Imagens: resposta de geração agora inclui conteúdo padrão para não exibir bolha vazia.
- Web: busca de imagens na web via SearXNG com envio direto no chat (sem embeddings de imagem).
- Dashboard: takeover/SLA/circuit breakers/conversas semanais agora com dados reais do backend.
- Integrações: métricas reais de Stripe/Wise/ERPNext expostas no dashboard.
- Users Admin: modal de edição com rolagem, senha redefinível e colunas de grupos/nome preferido.
- Namespaces: contagem real de agentes/docs e detalhes clicáveis no card.
- Observability: alertas Grafana com fallback de no-data para evitar falsos positivos (LLM/RAG/GPU).
- Observability: histogram_quantile protegido contra NaN (filtro de buckets) para evitar DatasourceNoData.
- Chat: efeito de digitação agora avança 1 caractere por tick e suporta até 400ms.
- Frontend: correção de build (variável não utilizada em AliceConfig).
- Chat: UX de digitação incremental com "Pensando..." i18n e velocidade configurável imediata.
- Frontend: formatação numérica e monetária agora respeita o locale do usuário em cards e tabelas.
- Trading: preços/volume/ordens usam locale do usuário (OrderBook e Candles incluídos).
- Frontend: correção de build para timestamp numérico e escopo de locale/timezone no Training.
- Frontend: JobCard recebe locale/timezone para evitar erro de build no Training.
- Auth: novos usuários OAuth/SAML/registro local agora entram como `guest` (Convidado).
- Users Admin: criação de usuário via dashboard (admin-only) com dados obrigatórios e roles iniciais.
- Users Admin: edição completa com preferências, roles, grupos e validação obrigatória de perfil.
- RBAC: admin/super_admin podem editar outros usuários; usuários comuns apenas a si mesmos.
- Auth: registro local protegido por CSRF + admin-only (sem cadastro público).
- Auth: evento de provisioning SAML agora usa fallback `guest` (consistente com OAuth/local).
- RBAC: resolveHighestRole não usa fallback quando roles existem (permite downgrade).
- Stack Ops: validação de versão persistida no histórico da conversa (mensagem salva + contadores).
- Agentic: confirmação respeita approvalPolicy novamente (sem bypass).
- ERPNext: configurator executa `bench` com `setpriv --keep-groups` (compatível com `no-new-privileges`).
- Deploy: logs de falha do ERPNext agora persistem como artifact no GitHub Actions.
- Deploy: logs de falha persistem para todos os stacks (infra, alice, observability, erpnext, backup).
- Deploy: diagnóstico rápido (tail) é exibido na tela antes do artifact.
- Deploy: healthchecks de OBSERVABILITY/ERPNEXT/BACKUP rodam quando stack é deployado.
- Timezone: containers em UTC; UI/Chat usam timezone do usuário com default `America/Sao_Paulo`.
- ERPNext: comando "inventario" agora mapeia corretamente para listagem de itens.
- Users Admin: atualização de roles/grupos agora é transacional (sem perda parcial).
- Auth: buildAuthContext propaga customRoleId para headers internos.
- Chat: fallback de role agora usa `guest` (evita ROLE_HIERARCHY inválido).
- Frontend: corrigidos erros de build (AgenticConfig null-safe, ordem de dependências no Chat, Checkbox UI e Users Admin).
- Frontend: Tabs de Usuários agora tipam corretamente o onValueChange.
- UX: textos didáticos reforçados em Dashboard, Integrações, Trading, Observability e Agentic.
- Agentic: fallback determinístico quando busca web falha mesmo com request explícito.
- Stack Ops: operações via GitHub Actions exigem confirmação explícita (action_requests).
- Modo Agentic: configuração por tenant (toggles + links) com persistência PostgreSQL.
- Agentic: execução real para ERPNext (read/write), pagamentos (Wise/Stripe) e stack ops (GitHub Actions).
- ERPNext: novos endpoints para clientes e faturas (listar/criar) + validação Zod.
- GitHub Actions: disparo de deploy/rollback via integrations-service com token seguro.
- Chat: foco persistente no input ao abrir novas conversas e selecionar histórico.
- Caddy: ACME resiliente com DNS precheck, DNS-01 DuckDNS e fallback ZeroSSL.
- Caddy: emissor ACME ajustado para sintaxe compatível no Caddyfile (dir + email global + eab inline).
- Grafana: regras de alerta ajustadas para evitar `DatasourceNoData` falso (bool + fallback 0/1).
- Grafana: alerta de restart filtrado por containers Docker Compose (sem slices do host).
- DB: migration `action_requests` agora aplica FKs completos (tenant/conversation/user/agent/resolved_by).
- OAuth GitHub: suporte a OAUTH_GITHUB_\* e fallback para GITHUB_\* legado.
- Docs: `SECRETS.md` atualizado com Redis cache/queue, MinIO e CORS.
- Frontend: normalização de line endings (CRLF → LF) em componentes de mídia do chat.
- Chat UI: mensagens somente com mídia agora ficam realmente sem fundo (bg transparente).
- Métricas: LLM tokens (prompt/gerados) instrumentados no chat-service.
- Métricas: relevância RAG emitida no chat-service por tenant quando há fontes.
- Grafana: UIDs de dashboards ajustados para não conflitar com folderUid.
- OAuth Google: callbackURL alinhado com config e suporte a path com trailing slash.
- OpenAI Images: payload padronizado (gpt-image-1 + output_format=png) com retorno `b64_json`.
- Agentic: política de aprovação por conversa (sempre confirmar / aprovar tudo neste chat).
- Agentic: confirmação persistida para ações críticas de trading (action_requests).
- Admin: formulário de roles customizadas aceita slug vazio e gera automaticamente.
- Chat: confirmação de nome ignora negativas explícitas do usuário.
- Chat UI: paste de imagem (Ctrl+V) anexa automaticamente no input.
- Chat UI: avatar do usuário maior e cores de mensagens alinhadas às da Alice.
- Chat UI: remoção dos cartões de sugestão no “Novo Chat”.
- Chat mídia: preview imediato preserva blob URL até upload confirmar.
- Chat mídia: limpeza de blob URL após upload concluído (media_uploaded).
- Configurações regionais: timezone, idioma da Alice e local (país/cidade) configuráveis no dashboard e persistidos em PostgreSQL.
- Chat: SERVER_TIME agora usa timezone do usuário em todos os fluxos (REST, stream e WebSocket).
- Frontend: datas e horários agora respeitam idioma/timezone do usuário em listas e cards.
- ERPNext: init ajusta permissões do volume + sync de `assets.json` da imagem, executando `bench` via `setpriv` (evita 404 de CSS/JS).
- RAG: timeout configurável por env (RAG_REQUEST_TIMEOUT_MS).
- Agentic web: busca web forçada quando o usuário pedir explicitamente (sem aprovação).
- Web/Deepweb: SearXNG com Tor via Ahmia habilitado; engine Torch desabilitado explicitamente para evitar falha na imagem atual.
- Web: cliente de busca agora envia `X-Forwarded-For`/`X-Real-IP` internos para evitar bloqueio do SearXNG (bot detection).
- Docs: `GUIA-CONFIGURACAO-INICIAL.md` expandido com passo a passo e exemplos para Agents, Agentic, Namespaces, System Prompt e Training.
- Docs: seção didática sobre funcionamento dos agentes no chat (roteamento, WhatsApp, handover) + prompts completos dos 7 pilares.
- Docs: configuração end-to-end por pilar (namespaces, agentes, toggles e treino) com exemplos prontos.
- Docs: exemplos completos de namespace + agente (payloads) para 8 pilares (inclui Fiscal).
- Web Search: headers de encaminhamento e user-agent interno no rag-service; SearXNG mantido como instância interna (public_instance=false) para evitar Valkey/limiter obrigatório.
- ASR: streaming OpenAI desabilitado por padrão e logging enriquecido para erros de transcrição.
- Prompt: instruções PT-BR para idioma, capacidades e SERVER_TIME.
- DB: nova tabela action_requests + enums para auditoria de ações.

- Pipeline modular enterprise e SSOT de versões.
- Healthchecks reais para todos os serviços.
- OpenAPI atualizado para geração de imagens via OpenAI.
- Remoção definitiva de VLM/FLUX local.
- Persistência completa do chat via streaming (conversas e mensagens salvas).
- Página enterprise de Configuração da Alice (system prompt, comportamento e humor).
- Validação do SSE `/api/chat/stream` antes de iniciar o streaming (evita erro de headers enviados).
- Observabilidade: scrape Prometheus corrigido (node-exporter via bridge, Qdrant com API key, Vector com exporter dedicado, Jaeger com métricas em 8888).
- GPU Manager: métricas de VRAM total/usada no fallback quando `nvidia-smi` não está disponível.
- Upload multimodal no streaming com análise de imagens via OpenAI e SSE `media_uploaded`.
- Headers internos para upload de mídia no RAG e geração de imagem via OpenAI (auth service-to-service).
- OpenAI Images: validação estrita de retorno `b64_json` (sem fallback por URL).
- OpenAI Vision: logs com `status` e `x-request-id` para diagnóstico real.
- Suporte enterprise a proxy (`OPENAI_PROXY`, `HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY`).
- Limite configurável de payload para Vision (`OPENAI_VISION_MAX_BYTES`).
- Build de microsserviços: serviços Alice reinstalam dependências após build de packages para injetar `dist/` dos workspaces.
- Incremento atômico de `totalMensagens` em streams concorrentes (evita perda de contagem).
- Upsert atômico em `/api/assistant-settings` para evitar conflito em concorrência.
- OpenAPI Chat: unificação do path `/api/chat/conversations/{id}` (GET + DELETE soft delete sem chave duplicada).
- Chat Sidebar: botão de excluir conversa visível via `group-hover` com classe `group` no item.
- Streaming de imagem: guarda defensiva quando `parsed.message` não é enviado no SSE de `generated_image`.
- Chat Service: exclusões (individual, lote, tudo) agora são transacionais para evitar perda de mensagens com conversa ainda ativa.
- Sidebar Desktop: colapso real ajusta largura e libera espaço do conteúdo.
- Chat Input: componente unificado com UX mobile-first e mesmas ações do input atual.
- Áudio no Chat: gravação com duas opções (revisar transcrição ou enviar direto).
- ASR OpenAI: gravação usa transcrição gpt-4o-transcribe via RAG (sem GPU local).
- Áudio no Chat: polling de transcrição encerra quando mídia é removida/enviada (sem texto fantasma).
- RBAC: resolver combina DB + PERMISSION_MAP para evitar 403 em permissões não seedadas.
- RBAC: roles customizadas inativas não concedem permissões no resolver.
- RBAC UI: fechamento do diálogo de permissões salva pendências (debounce flush).
- Auth API: endpoint de permissões ignora roles customizadas inativas.
- RBAC UI: busca no diálogo de permissões customizadas isolada da aba principal.
- Auth: resolver inclui PERMISSION_MAP + admin:alice_core:write (alinhado ao endpoint).
- Auth: PATCH custom-role valida tenant da role contra tenant do usuário alvo.
- Chat/Integrations: resolver inclui PERMISSION_MAP + admin:alice_core:write.
- Chat: CHAT_HISTORY_MIN_MESSAGES_* aceita 0 (inteiro >= 0) sem crash em produção.
- Chat: resposta de imagem não expõe provider e exibe apenas a imagem.
- Chat: pedidos explícitos de web retornam resposta determinística quando busca está indisponível.
- RBAC: roles customizadas por tenant (departamentos/funções) com permissões próprias.
- RBAC: usuários podem ter role base + role customizada simultaneamente.
- RBAC UI: criação de permissões guiada por módulo/recurso/ação (menos erro humano).
- Auth: CRUD de permissões limpa cache global (evita permissões stale entre tenants).
- Chat: fullscreen de imagem usa a mesma URL resolvida do thumbnail.
- Usuários: formulários de grupos e permissões resetam ao trocar o item editado.
- RBAC UI: toggles de permissões evitam overwrite em cliques rápidos.
- RBAC UI: fila sequencial e debounce evitam race em atualizações de permissões.
- Gateway: rota `/api/users*` encaminhada ao auth-service para gestão de usuários.
- Usuários: reset de formulário ao reabrir diálogo evita estado pendente.
- Chat: download usa URL resolvida (thumbnail ou original) para evitar HTML.
- UI: colapso da sidebar aplica largura ícone e elimina espaço vazio.
- Auth: callback Google respeita `OAUTH_CALLBACK_URL` e rota compatível.
- Auth: callback GitHub aceita override via `OAUTH_GITHUB_CALLBACK_URL` (baseado em `BASE_URL`).
- Observability: config do Jaeger usa exporter prometheus suportado.
- Auth: valida `OAUTH_CALLBACK_URL` para Google e aplica fallback seguro.
- Observability: telemetry metrics usa host/port inline no reader.
- Observability: dashboards corrigidos para queries unicas e semantica correta.
- Observability: backups sucesso/falha agora usam metricas reais do PostgreSQL.
- Observability: painel Similarity Score (Top-K) exibe K real (unidade e thresholds).
- UI: sidebar da dashboard colapsa totalmente sem autocollapse.
- Chat: streaming exibe apenas texto construindo em tempo real (sem status).
- Chat: velocidade do efeito de digitação configurável na Alice Config.
- Agentic: URL do SearXNG normalizada para garantir chamadas /search no web search.
- Namespaces: ajustes de tipos no formulário de configurações para build do frontend.
- Frontend build: ordem de handlers de gravação e avatar corrigida (evita TS2448/TS2454).
- Dark Mode: paleta preta/cinza para experiência similar ao ChatGPT.
- Avatar do Chat: GIF dinâmico (packman pensando, gato após resposta) com tamanho ajustado.
- pgBackRest: reset controlado quando `archive.info` existe sem `backup.info`.
- pgBackRest: captura stderr+stdout no stanza-create para detectar mismatch.
- pgBackRest: stanza-delete com `--force --force` no reset controlado.
- pgBackRest: stop file + limpeza de metadados no reset automático.
- ERPNext: mysqld_exporter usa .my.cnf gerado em runtime com usuário dedicado.
- TLS Caddy: ACME_EMAIL agora é obrigatório (fail-fast no deploy).
- ERPNext: ERPNEXT_MYSQL_EXPORTER_USER garantido na geração do .env.prod.
- Permissions-Policy: microfone liberado apenas para `self` (Caddy + Nginx).
- Alice Config: tratamento de erro de carregamento com UI estável e labels corretos.
- Chat streaming: status duplicado removido e sincronização de mensagens durante stream.
- Avatar do Chat: packman mantém estado durante streaming inicial sem flicker.
- Detecção de prompts de imagem ampliada (PT/EN + regex robusto).
- Branding: logo responsivo com `object-contain` e favicons ampliados.
- Sidebar desktop: auto-colapso após seleção + expansão por hover.
- Chat: avatar do assistente ampliado para melhor legibilidade.
- Namespaces: rotas do gateway ajustadas para o chat-service.
- Alice Config: refs de erro resetadas para permitir novos toasts após retry.
- Chat: input sempre ativo, botão Stop e opção de câmera no anexo.
- Permissions-Policy: câmera liberada para `self` no gateway e Nginx.
- Chat: Enter cria nova linha; envio via botão ou Alt+Enter.
- Chat: anexos clicáveis no input e mensagens com preview.
- Chat: sincronização de mensagens aguarda refetch após streaming (evita overwrite).
- Chat: auto-scroll respeita leitura e permite navegar toda a conversa.
- Chat: consulta web/deepweb habilitada para perguntas atuais (classificação agentic + contexto web).
- Chat: deepweb via SearXNG engine `ahmia` com Tor (`socks5h://alice-tor:9050`).
- Chat: comandos de trading executáveis via conversa (parser + execução direta).
- Trading: toggle de habilitação sincroniza cache do risco em tempo real.
- Jaeger: telemetry metrics com endpoint Prometheus compatível (0.0.0.0:8888).
- Chat: gravação de áudio com fallback de MIME type ao enviar/transcrever.
- Auth: BASE_URL definido para OAuth Google (evita redirect_uri_mismatch).
- Sidebar: colapso desktop reduz largura real (flex-basis).
- Chat: geração de imagens finaliza SSE com [DONE] em caso de erro.
- Chat: detecção de pedidos de imagem ampliada (logo/banner/avatar/etc).
- Chat: retry controlado na análise OpenAI Vision (erros transitórios).
- Chat: fallback automático quando OpenAI rejeita response_format.
- Build frontend: removido tipo não utilizado no schema compartilhado (TS6133).
- Caddy: entrypoint ajusta permissões de /data e /config antes de iniciar (certificados OK).
- Jaeger v2: telemetry metrics migrada para readers + exporter prometheus (sem restart loop).
- Permissões: Redis com GID 1000 alinhado ao usuário `redis` nas imagens Alpine 7.x.
- RBAC: nova permissão `admin:alice_core:write` para edição do Core da Alice.
- Auth: CRUD de permissões e atribuição por role via API.
- Auth: grupos organizacionais com membros por tenant.
- Frontend: página de gestão de usuários/grupos/permissões com filtros e ações.
- Alice Config: edição do core bloqueada sem permissão (somente leitura).
- Chat: regex de geração de imagem exige verbo de ação (evita falso positivo).
- Trading: cache de risk-config sincroniza via queryClient.
- UsersAdmin: queries dinâmicas corrigidas para membros de grupo e permissões por role.
- RBAC: cache global de permissões limpo ao atualizar roles (evita permissões stale).

---

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

#### sysctl (arquivo `/etc/sysctl.d/99-alice-tuning.conf`)

- `vm.swappiness=10`
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
- `max-concurrent-downloads: 10`
- `max-concurrent-uploads: 10`
- `live-restore: true`

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

## Referências internas

- `docs/ARQUITETURA.md`
- `docs/ARQUITETURA-GPU-MANAGER.md`
- `docs/DEPLOYMENT.md`
- `docs/OBSERVABILITY.md`
- `docs/SECRETS.md`
