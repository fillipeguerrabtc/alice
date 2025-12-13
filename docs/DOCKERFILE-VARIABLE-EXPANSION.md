# Dockerfile - Regras de Expansão de Variáveis (Enterprise)

**Autor:** Fillipe Guerra  
**Data:** 12 de Dezembro de 2025  
**Versão:** 1.0

## Visão Geral

Este documento estabelece as regras definitivas para expansão de variáveis em Dockerfiles, baseadas na documentação oficial do Docker e melhores práticas enterprise atuais (2025).

## Regra Fundamental: Docker Processa `$` ANTES de Passar ao Shell

O Docker processa caracteres `$` no Dockerfile **ANTES** de passar o comando ao shell. Isso significa que:

- `$VAR` → Docker tenta expandir como variável de ambiente/ARG do Docker
- `$$VAR` → Docker passa `$VAR` literal ao shell, que então expande como variável de shell

## Regras por Contexto

### 1. Docker ARGs (Build Arguments)

**Regra:** Use `$` simples (sem escape)

```dockerfile
ARG WAV2LIP_CHECKPOINT_SHA256
RUN echo "${WAV2LIP_CHECKPOINT_SHA256}  /opt/wav2lip/checkpoints/wav2lip_gan.pth" | sha256sum -c -
```

**Explicação:** Docker expande ARGs **ANTES** de passar ao shell, então `$` simples é suficiente.

### 2. Variáveis de Shell em RUN (Shell Form)

**Regra:** Use `$$` (double dollar) para escapar

```dockerfile
RUN set -euo pipefail; \
    WAV2LIP_COMMIT="bac9a81e63ecc153202353372e5724b83d9e6322"; \
    if git cat-file -e "$$WAV2LIP_COMMIT^{commit}" 2>/dev/null; then \
      echo "📦 Usando commit fixo: $$WAV2LIP_COMMIT"; \
      git checkout $$WAV2LIP_COMMIT; \
    fi
```

**Explicação:** 
- Variáveis de shell definidas no mesmo `RUN` precisam de `$$` para escapar
- Docker processa `$$` → passa `$VAR` literal ao shell
- Shell então expande `$VAR` corretamente

### 3. Command Substitution em RUN (Shell Form)

**Regra:** Use `$$(command)` para escapar

```dockerfile
RUN set -euo pipefail; \
    WAV2LIP_SIZE=$$(stat -f%z /opt/wav2lip/checkpoints/wav2lip_gan.pth 2>/dev/null || stat -c%s /opt/wav2lip/checkpoints/wav2lip_gan.pth 2>/dev/null || echo "0"); \
    if [ "$$WAV2LIP_SIZE" -lt 400000000 ]; then \
      echo "::error::wav2lip_gan.pth corrompido (tamanho: $${WAV2LIP_SIZE} bytes)"; \
      exit 1; \
    fi
```

**Explicação:**
- `$$(command)` → Docker passa `$(command)` literal ao shell
- Shell então executa command substitution corretamente

### 4. Variáveis de Shell Dentro de Strings (echo, etc.)

**Regra:** Use `$${VAR}` para escapar dentro de strings

```dockerfile
RUN echo "::error::wav2lip_gan.pth corrompido (tamanho: $${WAV2LIP_SIZE} bytes, esperado: ~400MB)"; \
```

**Explicação:**
- Dentro de strings, use `$${VAR}` para garantir que o `$` seja passado literal ao shell
- Shell então expande `${VAR}` corretamente

### 5. Variáveis de Shell Dentro de Funções Shell

**Regra:** Use `$$` mesmo dentro de funções definidas no mesmo RUN

```dockerfile
RUN set -euo pipefail; \
    download_with_token() { \
      local URL="$$1"; \
      local OUTPUT="$$2"; \
      local TOKEN="$$(cat /run/secrets/huggingface_token 2>/dev/null || echo '')"; \
      if [ -n "$$TOKEN" ]; then \
        HTTP_CODE=$$(curl -SL --retry 3 --retry-delay 5 --max-time 300 -H "Authorization: Bearer $${TOKEN}" -w "%{http_code}" -o "$$OUTPUT" "$$URL" 2>/dev/null || echo "000"); \
        if [ "$$HTTP_CODE" = "200" ] && [ -s "$$OUTPUT" ]; then \
          return 0; \
        fi; \
      fi; \
      return 1; \
    }
```

**Explicação:**
- Funções shell definidas no mesmo `RUN` seguem a mesma regra: usar `$$` para variáveis e command substitution
- Parâmetros de função: `$$1`, `$$2`, etc.
- Variáveis locais: `$$VAR`
- Command substitution: `$$(command)`

### 6. ENV (Environment Variables)

**Regra:** Use `${VAR}` simples (sem escape)

```dockerfile
ENV PYTHONPATH="/opt/sadtalker:${PYTHONPATH}"
```

**Explicação:** Docker expande variáveis em `ENV` antes de definir a variável de ambiente.

## Tabela de Referência Rápida

| Contexto | Sintaxe | Exemplo |
|----------|---------|---------|
| Docker ARG | `${ARG}` ou `$ARG` | `echo "${WAV2LIP_CHECKPOINT_SHA256}"` |
| Variável de shell em RUN | `$$VAR` | `WAV2LIP_COMMIT="..."; git checkout $$WAV2LIP_COMMIT` |
| Command substitution em RUN | `$$(command)` | `SIZE=$$(stat -c%s file)` |
| Variável de shell em string | `$${VAR}` | `echo "Tamanho: $${SIZE} bytes"` |
| ENV | `${VAR}` | `ENV PATH="/app:${PATH}"` |

## Exemplos Completos

### Exemplo 1: Variáveis de Shell + Command Substitution

```dockerfile
RUN set -euo pipefail; \
    # Variável de shell
    COMMIT="bac9a81e63ecc153202353372e5724b83d9e6322"; \
    # Command substitution
    BRANCHES=$$(git branch -r 2>/dev/null || echo ""); \
    # Uso de variável
    if [ -n "$$BRANCHES" ]; then \
      echo "Branches: $$BRANCHES"; \
    fi; \
    # Uso em string
    echo "Commit: $${COMMIT}"; \
    git checkout $$COMMIT
```

### Exemplo 2: Docker ARG + Variável de Shell

```dockerfile
ARG CHECKSUM_SHA256
RUN set -euo pipefail; \
    # Docker ARG usa $ simples
    if [ -z "${CHECKSUM_SHA256:-}" ]; then \
      echo "::error::CHECKSUM_SHA256 é obrigatório"; \
      exit 1; \
    fi; \
    # Variável de shell usa $$
    FILE_SIZE=$$(stat -c%s /opt/file.pth 2>/dev/null || echo "0"); \
    echo "Tamanho: $${FILE_SIZE} bytes"; \
    # Docker ARG em comando
    echo "${CHECKSUM_SHA256}  /opt/file.pth" | sha256sum -c -
```

## Erros Comuns

### ❌ ERRADO: Usar `$` simples para variáveis de shell

```dockerfile
RUN WAV2LIP_COMMIT="..."; git checkout $WAV2LIP_COMMIT
```

**Problema:** Docker tenta expandir `$WAV2LIP_COMMIT` como variável de ambiente/ARG antes de passar ao shell. Se não existir, passa string vazia.

### ❌ ERRADO: Usar `$$` para Docker ARGs

```dockerfile
ARG CHECKSUM
RUN echo "$${CHECKSUM}"  # ERRADO!
```

**Problema:** Docker não expande `$${CHECKSUM}`, passa literal ao shell. Shell não tem essa variável, resulta em string vazia.

### ✅ CORRETO: Usar `$$` para variáveis de shell, `$` para ARGs

```dockerfile
ARG CHECKSUM
RUN set -euo pipefail; \
    SIZE=$$(stat -c%s file); \
    echo "Checksum: ${CHECKSUM}"; \
    echo "Size: $${SIZE}"
```

## Referências Oficiais

- [Dockerfile Reference - Environment replacement](https://docs.docker.com/reference/dockerfile/#environment-replacement)
- [Dockerfile Reference - Shell and exec form](https://docs.docker.com/reference/dockerfile/#shell-and-exec-form)
- [Docker Build - Variables](https://docs.docker.com/build/building/variables)
- [Docker Compose - Interpolation](https://docs.docker.com/reference/compose-file/interpolation) (usa `$$` para escapar `$` literal)

## Notas Importantes

1. **SHELL directive:** Quando `SHELL ["/bin/bash", "-c"]` está definido, o comportamento é o mesmo: Docker processa `$` antes de passar ao shell.

2. **RUN --mount:** A regra é a mesma: variáveis de shell dentro do `RUN --mount` precisam de `$$`.

3. **Consistência:** Sempre use `$$` para variáveis de shell e command substitution em `RUN`, independente de estarem em funções, loops, ou condicionais.

4. **Teste:** Sempre teste builds localmente antes de commitar para garantir que expansão funciona corretamente.

---

**Última atualização:** 12 de Dezembro de 2025  
**Mantido por:** Fillipe Guerra
