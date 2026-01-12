# Branding - Alice Enterprise Platform

**Autor:** Fillipe Guerra

## Arquivos Oficiais

| Arquivo | Uso | Dimensões |
|---------|-----|-----------|
| `logo-round.png` | Logo principal (sidebar, header, landing page) | 512x512 |
| `favicon.png` | Favicon do navegador | 64x64 |

## Design do Logo

O logo da Alice é um **"A" estilizado** dentro de um círculo, representando:
- **A** de Alice (Assistente de IA)
- Design minimalista e moderno
- Cores: Preto (#2d2d2d) sobre fundo transparente

## Onde São Usados

### Frontend Alice (Produção)
- `apps/frontend-service/public/logo-round.png` - Sidebar, Login, Landing page
- `apps/frontend-service/public/favicon.png` - Tab do navegador

### Componentes que Usam o Logo
- `Login.tsx` - Página de login
- `app-sidebar.tsx` - Sidebar do dashboard
- `Landing.tsx` - Header, hero, cards, footer
- `App.tsx` - Tela de loading

### ERPNext
O ERPNext v15 suporta customização de branding via:
1. **Website Settings** → Brand Image (logo do site público)
2. **Letter Head** → Logo em documentos impressos

A interface interna do ERPNext mantém o branding padrão.

## Cores da Marca

- Preto/Cinza escuro: `#2d2d2d`
- Branco: `#ffffff`
- Fundo transparente para flexibilidade

## Script de Atualização

Para atualizar o branding:

```bash
# 1. Salve a nova imagem em assets/branding/alice-new-logo.png
# 2. Execute o script:
python scripts/update-branding.py

# O script irá:
# - Gerar favicon.png (64x64)
# - Gerar logo-round.png (512x512)
# - Copiar para apps/frontend-service/public/
```

## Manutenção

Esta pasta é a **fonte única de verdade** (SSOT) para todos os assets de branding.
Nunca modifique os arquivos em outras pastas diretamente.
Sempre atualize aqui primeiro usando o script `update-branding.py`.

---

*Autor: Fillipe Guerra*
*Atualizado: 12 de Janeiro de 2026*
*Logo: "A" estilizado dentro de círculo - design minimalista*
