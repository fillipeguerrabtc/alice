# Refatoração da Página Modo Agentic

**Author:** Fillipe Guerra  
**Data:** 27 de fevereiro de 2026

## Resumo

A página **Modo Agentic** foi refatorada para uma arquitetura modular com abas, removendo o formato monolítico anterior e melhorando escalabilidade de configuração por domínio operacional.

## Entregas Principais

1. Frontend modular em `apps/frontend-service/src/pages/agentic-config/`:
   - `AgenticConfigPage.tsx`
   - `AgenticConfigTabs.tsx`
   - `components/KeywordTextareaField.tsx`
   - `components/DetectorGroupEditor.tsx`
   - `components/ModuleHeaderCard.tsx`
   - `components/PlatformLinksEditor.tsx`
   - `components/ExecutionScopeToggles.tsx`
   - `components/NamespaceRoutingEditor.tsx`
   - `types.ts`
2. Abas por módulo:
3. Validação enterprise no editor de listas:
   - `trim`, deduplicação case-insensitive, limite de 200 itens e erro para linha acima de 160 caracteres.
   - Validação de regex textual no formato `/.../flags`.
4. Novo suporte a namespaces por módulo/categoria:
   - Vínculo explícito de namespaces para cada módulo, com persistência em `detectors.namespaceRouting.moduleBindings`.
   - Roteamento backend passa a considerar os bindings para priorizar namespaces/agentes corretos.
5. Namespace routing universal:
   - `detectors.namespaceRouting` com:
     - `baseKeywords`
     - `perNamespace`
     - `moduleBindings`
6. Compatibilidade com tenants legados:
   - Normalização e preenchimento automático de campos ausentes no backend.
7. i18n atualizado:
   - `pt-BR.json` e `en.json` com chaves novas de abas, descrições, erros, hints e namespaces.

## Backend

- `packages/shared/src/schema.ts` e `shared/schema.ts` atualizados para incluir `namespaceRouting.moduleBindings`.
- `apps/chat-service/src/index.ts` atualizado com:
  - defaults enterprise expandidos,
  - schema Zod de `agenticDetectors`,
  - normalização de detectores incluindo namespace routing,
  - helper `matchNamespaceByDetectors`,
  - priorização de namespace em `resolveSemanticRoute`,
  - fallback de roteamento manual por namespace em `resolveAgentRoutingForMessage`.

## Validações Executadas

1. `pnpm -w typecheck`
2. `pnpm -w test`
3. `pnpm -w lint`
4. `pnpm -w build`

Todas concluídas com sucesso.

## Hotfix de Build (Release)

**Author:** Fillipe Guerra  
**Data:** 27 de fevereiro de 2026

- Corrigida tipagem de `sources.internal` no parser de SSE do Chat:
  - arquivo: `apps/frontend-service/src/pages/Chat/index.tsx`
  - remoção explícita de `null` com type predicate para `InternalSourceReference`.
- Corrigida tipagem do editor de keywords para evitar união com arrays não-string:
  - arquivo: `apps/frontend-service/src/pages/agentic-config/components/KeywordTextareaField.tsx`
  - sanitização de `field.value` para `string[]` antes de `listToTextarea`.
- Validação pós-correção:
  1. `pnpm --filter @alice/frontend-service typecheck`
  2. `pnpm --filter @alice/frontend-service build`
  3. `pnpm -w typecheck`
  4. `pnpm -w test`
  5. `pnpm -w lint`
  6. `pnpm -w build`
