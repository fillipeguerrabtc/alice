#!/bin/bash
echo "=== TESTE 1: Request SIMPLES (sem JSON schema) ==="
START=$(date +%s%N)
RESULT=$(curl -s -X POST http://localhost:8000/v1/chat/completions -H "Content-Type: application/json" -d '{"model":"Qwen/Qwen2.5-7B-Instruct-AWQ","messages":[{"role":"user","content":"Give a short BTC analysis"}],"max_tokens":200,"stream":false}')
END=$(date +%s%N)
ELAPSED=$(( (END - START) / 1000000 ))
echo "Tempo: ${ELAPSED}ms"
echo "$RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); print('Tokens:', d.get('usage',{}).get('completion_tokens','?')); print('Content:', d['choices'][0]['message']['content'][:200])" 2>/dev/null
echo ""

echo "=== TESTE 2: Request com response_format json_schema ==="
START2=$(date +%s%N)
RESULT2=$(curl -s -X POST http://localhost:8000/v1/chat/completions -H "Content-Type: application/json" -d '{"model":"Qwen/Qwen2.5-7B-Instruct-AWQ","messages":[{"role":"system","content":"You are a trading analyst. Respond ONLY in JSON."},{"role":"user","content":"Analyze BTC for trading. Give signal type, confidence, reasoning."}],"max_tokens":500,"stream":false,"response_format":{"type":"json_schema","json_schema":{"name":"trading_signal","strict":true,"schema":{"type":"object","properties":{"signalType":{"type":"string","enum":["entry_long","entry_short","neutral"]},"confidence":{"type":"number"},"reasoning":{"type":"string"}},"required":["signalType","confidence","reasoning"],"additionalProperties":false}}}}')
END2=$(date +%s%N)
ELAPSED2=$(( (END2 - START2) / 1000000 ))
echo "Tempo: ${ELAPSED2}ms"
echo "$RESULT2" | python3 -c "import sys,json; d=json.load(sys.stdin); print('Tokens:', d.get('usage',{}).get('completion_tokens','?')); print('Content:', d['choices'][0]['message']['content'][:300])" 2>/dev/null
echo ""

echo "=== TESTE 3: Request com response_format json_object (sem schema) ==="
START3=$(date +%s%N)
RESULT3=$(curl -s -X POST http://localhost:8000/v1/chat/completions -H "Content-Type: application/json" -d '{"model":"Qwen/Qwen2.5-7B-Instruct-AWQ","messages":[{"role":"system","content":"You are a trading analyst. Respond ONLY as JSON with keys: signalType, confidence, reasoning."},{"role":"user","content":"Analyze BTC for trading."}],"max_tokens":500,"stream":false,"response_format":{"type":"json_object"}}')
END3=$(date +%s%N)
ELAPSED3=$(( (END3 - START3) / 1000000 ))
echo "Tempo: ${ELAPSED3}ms"
echo "$RESULT3" | python3 -c "import sys,json; d=json.load(sys.stdin); print('Tokens:', d.get('usage',{}).get('completion_tokens','?')); print('Content:', d['choices'][0]['message']['content'][:300])" 2>/dev/null
