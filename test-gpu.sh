#!/bin/bash
echo "=== TESTE SIMPLES GPU-LLM ==="
curl -s -X POST http://localhost:8000/v1/chat/completions -H "Content-Type: application/json" -d '{"model":"Qwen/Qwen2.5-7B-Instruct-AWQ","messages":[{"role":"user","content":"Say OK"}],"max_tokens":10,"stream":false}' | head -c 500
echo ""
echo "=== GPU-LLM CONFIG ENV ==="
env | grep -E 'QUANT|MAX_MODEL|GPU_MEM|MAX_NUM|MAX_BATCH' | sort
