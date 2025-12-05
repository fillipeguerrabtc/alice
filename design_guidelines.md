# Alice - Diretrizes de Design Enterprise

**Autor:** Fillipe Guerra

## Filosofia de Design

**Plataforma enterprise de IA** com estética sofisticada combinando a precisão do Linear, a clareza do Stripe e a acessibilidade do Notion. Interface moderna, rica em dados, com foco em Português Brasileiro.

---

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

---

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

---

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

---

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
| ERPNext | Widgets via API ou iframes |
| Usuários | Tabela com badges de role, dropdowns de ações |

### Configurações

- Navegação em abas (horizontal ou lista vertical)
- Seções de formulário com divisores claros
- Ações perigosas (Excluir, Desconectar) em card separado no rodapé
- Barra de rodapé persistente para salvar

---

## Interações e Animações

| Tipo | Duração | Uso |
|------|---------|-----|
| Micro-interações | 200ms | Hover, toggle, feedback |
| Modais | 300ms | Abertura/fechamento |
| Dropdowns | 150ms | Slide-down com fade |
| Loading | Skeleton | Seções com dados (NÃO spinners) |
| Toast | 4s | Auto-dismiss, canto superior direito |

**Regra:** Animações mínimas - priorizar velocidade e clareza.

---

## Acessibilidade (WCAG 2.1 AA)

- [ ] Contraste alto de texto
- [ ] Estados de foco visíveis em elementos interativos
- [ ] Navegação por teclado (tab order, escape para fechar modais)
- [ ] Labels de screen reader em botões apenas com ícone
- [ ] Erros de formulário anunciados
- [ ] aria-labels em todos os elementos interativos

---

## Imagens e Mídia

| Contexto | Diretrizes |
|----------|------------|
| Dashboard Admin | Sem hero images - dados e métricas são o foco |
| Interface de Chat | Avatares (32px círculos), anexos de mídia inline |
| Configurações | Ícones (24px) para identificação visual |
| Marketing | Hero com gradiente abstrato IA/tech ou padrões geométricos |

---

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
*Atualizado: 05 de Dezembro de 2025*
*Total de Containers: 27 (5 infraestrutura + 8 Alice + 12 ERPNext + 2 backup/logs)*
