-- Migration: 0099_hybrid_routing_policy
-- Descrição: Política híbrida de roteamento semântico com threshold e revisão humana por tenant
-- Autor: Fillipe Guerra
-- Data: 06 de Março de 2026

INSERT INTO system_config (key, value, updated_at)
VALUES (
  'HYBRID_ROUTING_DEFAULT_POLICY_JSON',
  $$
  {
    "version": 1,
    "enabled": true,
    "thresholds": {
      "autoAccept": 0.12,
      "humanReview": 0.06,
      "clusterAutoTagConfidence": 0.90,
      "clusterAutoTagMinSize": 8
    },
    "transversalDefault": {
      "enabled": true,
      "defaultNamespaceSlug": "default",
      "greetingsToDefault": true,
      "reuseGateToDefault": true,
      "domainExceptionTerms": [
        "trade",
        "trading",
        "btc",
        "bitcoin",
        "eth",
        "ethereum",
        "futuros",
        "alavancagem",
        "leverage",
        "ordem",
        "sinal",
        "position",
        "kucoin",
        "binance",
        "compliance",
        "fiscal",
        "juridico",
        "contabilidade"
      ]
    },
    "humanReview": {
      "enabled": true,
      "queueLowConfidenceRouting": true,
      "highRiskRoutes": ["/trading", "/wise"]
    },
    "exceptions": []
  }
  $$,
  NOW()
)
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value,
    updated_at = NOW();
