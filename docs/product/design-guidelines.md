# Diretrizes de Design da Alice

**Author:** Fillipe Guerra
**Data:** 19 de Marco de 2026
**Atualizado:** 20 de Marco de 2026
**Status:** ativo
**Tipo:** ssot

## Objetivo

Consolidar os principios visuais, de interface e de experiencia da Alice sem duplicar detalhes de implementacao de componentes ou fluxos operacionais fora do contexto de design.

## Principios de design

Plataforma enterprise de IA com estetica sofisticada, foco em clareza operacional, leitura de dados e suporte nativo a Portugues Brasileiro.

## Identidade Visual

### Tipografia

| Tipo | Fonte | Uso |
|------|-------|-----|
| **Primária** | Inter | Títulos, elementos UI, métricas |
| **Secundária** | IBM Plex Sans | Texto corrido, descrições |
| **Código** | JetBrains Mono | Logs, chaves API, dados técnicos |

### Hierarquia Tipográfica

| Elemento | Tamanho | Peso | Uso |
|----------|---------|------|-----|
| Hero/H1 | 48-56px | Bold | Títulos principais |
| H2 | 32px | Semibold | Seções do dashboard |
| H3 | 24px | Semibold | Subseções |
| Body | 16px | Regular | Texto padrão |
| Body-lg | 18px | Regular | Texto importante |
| Small | 14px | Regular | Metadados |
| XS | 12px | Regular | Legendas |

## Sistema de Layout

### Espaçamento (Tailwind)

Usar escala consistente: `2, 4, 8, 12, 16, 24, 32` (px-2, h-8, m-12, etc.)

### Larguras Máximas

| Contexto | Classe Tailwind |
|----------|-----------------|
| Dashboard | `max-w-7xl` (80rem) |
| Formulários | `max-w-4xl` (56rem) |
| Interface de Chat | `max-w-3xl` (48rem) |
| Conteúdo texto | `max-w-prose` |

## Design de Componentes

### Navegação

- **Sidebar esquerda persistente** (256px) para dashboard admin
- Seções colapsáveis com ícones + rótulos
- Estado ativo: fundo sutil + borda esquerda accent
- Barra superior: breadcrumbs, busca, notificações, menu do usuário

### Cards (Cartões)

- Bordas sutis (`border-border`)
- Cantos arredondados (`rounded-lg` a `rounded-xl`)
- Hover: elevação suave com transição
- Cards de métricas: números grandes (32px) com ícones, indicadores de tendência

### Tabelas/Grids de Dados

- Backgrounds alternados para legibilidade
- Cabeçalhos fixos no scroll
- Ações de linha reveladas no hover
- Colunas ordenáveis com indicadores sutis
- Paginação no rodapé: "Mostrando X-Y de Z"

### Formulários

- Seções agrupadas com rótulos claros
- Validação inline (checkmark verde / X vermelho)
- Texto de ajuda abaixo dos inputs (`text-sm text-muted-foreground`)
- Ações primárias à direita, secundárias à esquerda

### Botões

| Variante | Estilo | Uso |
|----------|--------|-----|
| Primary | Sólido | Ações principais |
| Secondary | Contornado | Ações secundárias |
| Destructive | Vermelho | Ações destrutivas |
| Ghost | Transparente | Ações terciárias |
| Icon | 40x40px | Botões apenas com ícone |

### Interface de Chat

- **Mensagens do usuário:** Bolha à direita, cor primary
- **Mensagens da Alice:** Bolha à esquerda, cor neutra
- Topo do chat principal em padrao minimalista, com o titulo `Alice` como ponto principal de configuracao da conversa
- `Raciocínio`, `Área` e `Agente` devem viver no menu contextual do titulo `Alice`, nunca em uma faixa fixa dedicada abaixo do header
- O menu `Alice` controla a configuracao persistida da conversa; o resumo compacto do topo deve refletir o roteamento efetivo aplicado pela plataforma
- `Área` representa o namespace ativo da conversa e pode voltar para modo automático sem esconder o contexto da conversa
- `Agente` representa o especialista dentro da área selecionada; quando estiver em automático, o roteamento continua livre dentro do escopo permitido
- `Raciocínio` usa apenas os labels `Automático`, `Rápido` e `Mais Profundo`
- O topo do chat deve exibir o estado atual de `Área` e `Agente` em formato compacto, inclusive quando ambos estiverem em modo automático
- Quando a conversa estiver em modo automatico, `Área` e `Agente` visiveis no topo devem representar o estado efetivo retornado por `routing`, e nao apenas a selecao persistida do usuario
- O composer deve exibir o `Raciocínio` atual como estado visível da conversa, em linguagem compacta no estilo ChatGPT
- Quando `Área` ou `Agente` estiverem em modo manual, a superficie principal deve reforcar esse override sem voltar a usar formulario persistente
- Workspace selector nao faz parte da experiencia principal do chat
- Operações, governança e diagnóstico devem viver em superficies dedicadas de navegação, nunca como trilhas principais dentro do topo do chat
- O botao `+` do composer deve ficar reservado para anexos e futuras acoes do input; configuracao da conversa nao deve competir com esse menu
- A tela inicial vazia do chat deve ser leve, limpa e sem ilustrações pesadas concorrendo com a entrada da conversa
- A interface principal do chat deve diferenciar explicitamente `empty state mode` e `conversation mode`
- Em `empty state mode`, o chat deve exibir apenas uma headline curta e dinamica, centralizada verticalmente, com o composer logo abaixo
- A headline da tela vazia deve vir de um contrato real da plataforma, considerar contexto autentico do usuario quando existir e evitar repeticao imediata
- Em `conversation mode`, o composer deve voltar para o rodape visual do chat sem linha divisoria superior evidente
- A transicao entre composer centralizado e composer no rodape deve ser suave e responsiva em desktop e mobile
- Streaming, thinking e respostas parciais devem respeitar a largura util do chat, sem overflow horizontal, sem scrollbar oscilando e sem exceder o limite visual definido para o painel de thinking
- Preview de mídia inline (imagens/vídeos reproduzíveis)
- Área de upload: borda tracejada, drag-drop
- Gravação de voz: animação de forma de onda
- Indicador de digitação: pontos animados

### Dashboards Financeiros

- Cards de saldo proeminentes no topo
- Exibição multi-moeda com taxas de conversão
- Timeline de transações com filtragem
- Botões de ação contextuais por linha
- Workflows de aprovação com estados claros (pendente/aprovado/rejeitado)

### Modais

- Overlay centralizado com backdrop blur
- Largura máxima baseada no conteúdo:
  - Formulários: `max-w-2xl`
  - Previews: `max-w-4xl`
- Botão fechar no canto superior direito
- Rodapé com ações alinhadas à direita

## Layouts por Página

### Landing (Página Inicial)

- **Hero:** Viewport completo com gradiente, mensagem centralizada
- **Features:** Grid de 3 colunas (desktop), empilhado (mobile)
- **Social proof:** Logos, depoimentos em cards
- **CTAs:** Backgrounds contrastantes

### Interface de Chat

- Layout limpo, sem distrações
- Mensagens centralizadas com largura máxima
- Sidebar: histórico de conversas (esquerda, colapsável)
- Barra de input: fixa no rodapé com upload, voz, emoji
- Mídia: renderização inline com lightbox no clique

### Dashboard Admin

| Módulo | Layout |
|--------|--------|
| Visão Geral | Grid de KPIs (4 cols), gráficos, feed de atividade |
| Financeiro | Resumo de saldo, tabela de transações, filtros lateral |
| Emails | Toggle lista/grid, editor de templates com preview |
| Stripe | Interface multi-abas (Saldo, Pagamentos, Saques, Disputas) |
| Usuários | Tabela com badges de role, dropdowns de ações |

### Configurações

- Navegação em abas (horizontal ou lista vertical)
- Seções de formulário com divisores claros
- Ações perigosas (Excluir, Desconectar) em card separado no rodapé
- Barra de rodapé persistente para salvar

## Interações e Animações

| Tipo | Duração | Uso |
|------|---------|-----|
| Micro-interações | 200ms | Hover, toggle, feedback |
| Modais | 300ms | Abertura/fechamento |
| Dropdowns | 150ms | Slide-down com fade |
| Loading | Skeleton | Seções com dados (NÃO spinners) |
| Toast | 4s | Auto-dismiss, canto superior direito |

**Regra:** Animações mínimas - priorizar velocidade e clareza.

## Acessibilidade (WCAG 2.1 AA)

- [ ] Contraste alto de texto
- [ ] Estados de foco visíveis em elementos interativos
- [ ] Navegação por teclado (tab order, escape para fechar modais)
- [ ] Labels de screen reader em botões apenas com ícone
- [ ] Erros de formulário anunciados
- [ ] aria-labels em todos os elementos interativos

## Imagens e Mídia

| Contexto | Diretrizes |
|----------|------------|
| Dashboard Admin | Sem hero images - dados e métricas são o foco |
| Interface de Chat | Avatares (32px círculos), anexos de mídia inline |
| Configurações | Ícones (24px) para identificação visual |
| Marketing | Hero com gradiente abstrato IA/tech ou padrões geométricos |

## Considerações para Português Brasileiro

| Aspecto | Formato |
|---------|---------|
| Idioma | Português do Brasil (PT-BR) |
| Formato de data | DD/MM/YYYY |
| Moeda | EUR com formatação correta (€1.234,56) |
| Textos | Acomodar ~20% mais espaço que inglês |
| Mensagens de erro | Amigáveis e profissionais |

### Exemplos de Textos

```
// Saudações
"Olá, {nome}"
"Bem-vindo de volta"

// Ações
"Salvar alterações"
"Cancelar"
"Confirmar"
"Excluir"

// Estados
"Carregando..."
"Nenhum resultado encontrado"
"Ocorreu um erro. Tente novamente."

// Validação
"Campo obrigatório"
"Email inválido"
"Senha muito curta"
```

---

## Polimento Enterprise

- [ ] Espaçamento consistente em toda a aplicação
- [ ] Paleta de cores profissional (evitar cores muito vibrantes)
- [ ] Densidade de dados balanceada com whitespace
- [ ] Tooltips de ajuda contextual (ícones de interrogação)
- [ ] Funcionalidade de exportação proeminente (botões CSV, PDF)
- [ ] Filtros sempre visíveis ou facilmente acessíveis
- [ ] Atalhos de teclado documentados no menu de ajuda

---

## Tema Dark/Light

### Obrigatório em todas as páginas

- Toggle acessível no header
- Persistido em `localStorage`
- Respeita preferência do sistema (`prefers-color-scheme`)
- Transição suave entre temas (200ms)

### Cores Semânticas

| Token | Uso |
|-------|-----|
| `--background` | Fundo principal |
| `--foreground` | Texto principal |
| `--card` | Fundo de cards |
| `--primary` | Ações principais, links |
| `--secondary` | Ações secundárias |
| `--muted` | Elementos desabilitados, placeholders |
| `--accent` | Destaques |
| `--destructive` | Erros, ações destrutivas |

---

## Checklist de Design

Antes de entregar qualquer página:

- [ ] Funciona em mobile, tablet e desktop
- [ ] Tema dark e light funcionando
- [ ] Estados de loading (skeleton)
- [ ] Estados de erro com mensagens claras
- [ ] Estados vazios com call-to-action
- [ ] Hover/focus states em elementos interativos
- [ ] Textos em Português BR
- [ ] Formatação de data/moeda correta
- [ ] Acessibilidade verificada
- [ ] Performance aceitável (<3s carregamento)

---

**Este documento deve ser consultado antes de criar qualquer componente visual.**

---

*Autor: Fillipe Guerra*
*Documentação em Português Brasileiro (Regra 10 CLAUDE.md)*
*Atualizado: 27 de Dezembro de 2025*
