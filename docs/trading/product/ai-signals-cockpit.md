# AI Signals Cockpit

**Author:** Fillipe Guerra
**Data:** 18 de Marco de 2026
**Atualizado:** 18 de Marco de 2026
**Status:** ativo
**Tipo:** ssot

## Objetivo

Descrever a experiencia atual de Sinais IA no workspace de Trading, com estados de produto explicitos e handoffs auditaveis para Demo, Training e elegibilidade real.

## Estados de produto

- `blocked`
- `no_trade`
- `signal_generated`
- `executed`
- `failed`

## Leitura dos estados

- `blocked`: execucao barrada por guardrail, configuracao ou contexto invalido.
- `no_trade`: houve processamento valido, mas sem edge seguro.
- `signal_generated`: existe sinal gerado e ainda nao executado.
- `executed`: houve handoff ou aprovacao operacional registrada.
- `failed`: ocorreu falha tecnica real.

## Contrato principal

- Rota: `POST /api/integrations/trading/signals/generate`
- Resposta relevante:
  - `signalGeneration.stateCategory`
  - `signalGeneration.reasonCode`
  - `signalGeneration.reasonHuman`

## Handoffs first-class

- `Enviar para Demo`: `POST /api/integrations/demo-trading/orders/from-signal`
- `Enviar para Training dataset`: `POST /api/integrations/trading/datasets/from-signal`
- `Promotion path`: `GET /api/integrations/trading/signals/:id/promotion-path`
- `Promover para real eligibility`: `POST /api/integrations/trading/signals/:id/promote-real-eligibility`

## Regras de UX

- `neutral` e `hold` nao devem aparecer como sinal direcional util.
- `blocked` e `no_trade` nao podem ser escondidos atras de erro generico.
- O painel avancado de governanca continua acessivel, mas nao substitui a leitura rapida do cockpit.

## Referencias

- [workspace-shell.md](workspace-shell.md)
- [../operations/training-calibration-promotion-path.md](../operations/training-calibration-promotion-path.md)
- [../architecture/auto-engine-contracts-observability.md](../architecture/auto-engine-contracts-observability.md)
