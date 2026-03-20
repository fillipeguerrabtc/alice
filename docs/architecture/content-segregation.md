# Segregacao de Conteudo

**Author:** Fillipe Guerra
**Data:** 20 de Marco de 2026
**Atualizado:** 20 de Marco de 2026
**Status:** ativo
**Tipo:** ssot

## Objetivo

Definir o modelo canonico de segregacao de conteudo da Alice para recursos privados e compartilhados dentro do mesmo tenant.

## Principios obrigatorios

- `Private by default`.
- `Explicit share`.
- `Default deny`.
- Nenhum recurso sensivel pode ser lido, listado, pesquisado, treinado ou executado apenas por `tenantId`.
- Toda decisao de acesso precisa passar por `tenant check + ownership/grant check + policy check`.
- Admin do tenant nao recebe leitura implicita de conteudo privado; acesso excepcional depende de `break-glass` auditado ou grant explicito.

## Modelo estrutural

Os recursos sensiveis padronizam, conforme aplicavel:

- `tenant_id`
- `owner_user_id`
- `owner_group_id`
- `created_by_user_id`
- `updated_by_user_id`
- `scope_type`
- `visibility`
- `sensitivity_label`

Os grants explicitos vivem em `resource_access_grants`, com escopo por `tenant_id`, `resource_type`, `resource_id`, sujeito (`user`, `group`, `role`, `tenant`) e permissao efetiva.

## Enforcement por camada

### Banco

- O request injeta GUCs de autorizacao:
  - `app.current_tenant_id`
  - `app.current_user_id`
  - `app.current_role`
  - `app.current_role_codes`
  - `app.current_group_ids`
  - `app.current_custom_role_id`
  - `app.is_super_admin`
  - `app.break_glass_active`
- Tabelas sensiveis operam com `RLS + FORCE RLS`.
- As decisoes SQL centralizadas usam:
  - `alice_is_resource_owner`
  - `alice_has_resource_grant`
  - `alice_can_access_resource`
  - `alice_can_access_scope`

### Aplicacao

- Toda rota ou service que acessa recurso privado deve usar `authorizeResourceAccess(...)` ou executar a consulta sob contexto RLS equivalente.
- E proibido consultar recurso sensivel por PK e so depois aplicar filtro parcial de escopo.
- Fluxos por `conversationId`, `documentId`, `namespaceId` e `agentId` devem validar ownership ou grant antes de carregar dados derivados.

### Retrieval e indice vetorial

Cada ponto vetorial precisa persistir:

- `tenantId`
- `namespaceId`
- `agentId`
- `documentId`
- `chunkId`
- `ownerUserId`
- `ownerGroupId`
- `scopeType`
- `visibility`
- `sensitivityLabel`
- `allowedRoleCodes`
- `allowedGroupIds`
- `sourceType`
- `scopeKey`

O filtro de retrieval deve restringir a busca na origem por tenant e por sujeito compativel com ownership, grants e visibilidade. Pos-filtrar somente depois da busca nao atende ao modelo canonico.

### Storage e cache

- Uploads privados e compartilhados usam paths segregados por `tenantId` e sujeito.
- Chaves de cache devem incluir `tenantId` e o sujeito efetivo (`userId` ou hash de grants/escopo equivalente).
- E proibido reutilizar cache tenant-only para listagens, retrieval ou respostas privadas.

### Training

- `training_data` so pode nascer de conteudo acessivel ao ator no momento da coleta.
- O registro deve persistir snapshot de ownership, grants e permissao usada na coleta.
- Conteudo de terceiros nao pode entrar em treino sem grant explicito.

## Recursos cobertos

- `conversations`
- `messages`
- `documents`
- `document_chunks`
- `media_uploads`
- `generated_images`
- `training_data`
- `namespaces`
- `agents`
- `tool_policies`
- `prompt_templates`
- `llm_execution_audit`

## Referencias

- [platform.md](platform.md)
- [../operations/permissions.md](../operations/permissions.md)
- [../operations/training/learning-system.md](../operations/training/learning-system.md)
