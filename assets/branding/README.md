# Branding local

**Author:** Fillipe Guerra
**Data:** 18 de Marco de 2026
**Atualizado:** 18 de Marco de 2026
**Status:** ativo
**Tipo:** readme local

## Escopo local

Esta pasta guarda os arquivos raster versionados do branding e o fluxo local de atualizacao dos assets consumidos pelo frontend.

Diretrizes visuais, linguagem de interface e padroes de design nao ficam aqui; o SSOT global continua em [docs/product/design-guidelines.md](../../docs/product/design-guidelines.md).

## Arquivos desta pasta

| Arquivo | Papel local |
| --- | --- |
| `logo-round.png` | logo raster principal atualmente distribuido para o frontend |
| `favicon.png` | favicon em PNG gerado pelo fluxo local |
| `favicon.ico` | favicon de compatibilidade usado pelo frontend |
| `logo-round_old.png` | referencia historica; nao usar como asset ativo |

## Fluxo local de atualizacao

O fluxo oficial desta pasta usa [scripts/update-branding.py](../../scripts/update-branding.py):

```bash
python scripts/update-branding.py assets/branding/<arquivo-origem>.png
```

O script:

- gera `favicon.png` em `128x128`
- gera `logo-round.png` em `1024x1024`
- copia os dois PNGs para `apps/frontend-service/public/`

## Consumo atual

O frontend consome os arquivos publicados em `apps/frontend-service/public/`:

- `favicon.ico`
- `favicon.png`
- `logo-round.png`

O `favicon.ico` nao e atualizado por `scripts/update-branding.py`; se ele precisar mudar, a revisao e sincronizacao devem ser feitas conscientemente.

## Limites deste README

- Nao redefine paleta, tipografia ou regras globais de produto.
- Nao documenta deploy, pipeline ou arquitetura global.
- Nao substitui o SSOT de design em `docs/product/`.
