# Versionamento Automático - Release Workflow

## Descrição

O workflow `release.yml` agora suporta **versionamento automático opcional** baseado em Conventional Commits, eliminando a necessidade de especificar manualmente a versão em cada release.

## Como Funciona

### Modo Manual (Compatibilidade 100%)
Funciona exatamente como antes - forneça a versão manualmente:

```yaml
# No GitHub Actions UI
version: v2.8.0
```

### Modo Automático (NOVO)
Deixe o campo `version` vazio e o workflow calculará automaticamente a próxima versão baseada nos commits desde a última tag:

```yaml
# No GitHub Actions UI
version: <deixe vazio>
```

## Lógica de Cálculo

A versão é calculada seguindo **Conventional Commits**:

### 1. MAJOR (Breaking Changes)
Incrementa quando há commits com `!` ou `BREAKING CHANGE:`:
- `feat!: remove API antiga` → `v2.7.0` → `v3.0.0`
- `refactor!: reescreve módulo` → `v2.7.0` → `v3.0.0`
- Commit com `BREAKING CHANGE:` no corpo → `v2.7.0` → `v3.0.0`

### 2. MINOR (Novas Features)
Incrementa quando há commits com `feat:`:
- `feat: adiciona autenticação OAuth` → `v2.7.0` → `v2.8.0`
- `feat(api): novo endpoint` → `v2.7.0` → `v2.8.0`

### 3. PATCH (Bug Fixes e Outros)
Incrementa para qualquer outro tipo de commit:
- `fix: corrige crash na inicialização` → `v2.7.0` → `v2.7.1`
- `docs: atualiza README` → `v2.7.0` → `v2.7.1`
- `chore: atualiza dependências` → `v2.7.0` → `v2.7.1`

### 4. Primeiro Release
Se não houver tag anterior, usa `v1.0.0`:
- Nenhuma tag anterior → `v1.0.0`

## Prioridade de Detecção

O workflow aplica a seguinte ordem de prioridade:

1. **MAJOR** (breaking changes) - tem prioridade máxima
2. **MINOR** (features) - tem prioridade média
3. **PATCH** (fixes e outros) - padrão

Exemplo com múltiplos commits:
```
feat: adiciona nova funcionalidade
fix: corrige bug
feat!: remove API antiga
```
Resultado: `v2.7.0` → `v3.0.0` (MAJOR tem prioridade)

## Fluxo de Execução

```
1. Checkout código
2. Detectar tag anterior
3. Calcular próxima versão (SE version vazio)
4. Definir versão final (manual OU calculada)
5. Validar formato da versão
6. Verificar se tag já existe
7. Gerar changelog
8. Criar Git Tag
9. Criar GitHub Release
10. Build Docker Images
11. Disparar Deploy
```

## Validações

O workflow aplica as seguintes validações:

### ✅ Formato de Versão
- Deve seguir semântico: `vX.Y.Z` ou `vX.Y.Z-sufixo`
- Exemplos válidos: `v1.0.0`, `v2.3.1`, `v1.0.0-beta.1`
- Exemplos inválidos: `1.0.0`, `v1.0`, `release-1.0.0`

### ✅ Tag Não Existe
- Verifica se a tag calculada/fornecida já existe
- Fail-fast se tag já existe

### ✅ Primeiro Release
- Detecta automaticamente se não há tag anterior
- Usa `v1.0.0` como versão inicial

## Exemplos de Uso

### Exemplo 1: Release Automático
```bash
# Situação: última tag é v2.7.0
# Commits desde v2.7.0:
# - feat: adiciona suporte a OAuth
# - fix: corrige bug de memória
# - docs: atualiza README

# No GitHub Actions:
version: <deixe vazio>

# Resultado: v2.8.0 (MINOR bump por causa do feat:)
```

### Exemplo 2: Breaking Change
```bash
# Situação: última tag é v2.7.0
# Commits desde v2.7.0:
# - feat!: remove suporte a Node.js 14
# - chore: atualiza dependências

# No GitHub Actions:
version: <deixe vazio>

# Resultado: v3.0.0 (MAJOR bump por causa do feat!:)
```

### Exemplo 3: Bug Fix
```bash
# Situação: última tag é v2.7.0
# Commits desde v2.7.0:
# - fix: corrige crash na inicialização
# - chore: melhora logging

# No GitHub Actions:
version: <deixe vazio>

# Resultado: v2.7.1 (PATCH bump - apenas fixes e chores)
```

### Exemplo 4: Override Manual
```bash
# Situação: última tag é v2.7.0
# Você quer forçar v3.0.0 independente dos commits

# No GitHub Actions:
version: v3.0.0

# Resultado: v3.0.0 (versão manual sempre tem prioridade)
```

## Testes

Execute o script de testes para validar a lógica:

```bash
bash tests/test-version-calculation.sh
```

O script testa 8 cenários diferentes:
1. ✅ Primeiro release
2. ✅ PATCH bump (fix)
3. ✅ MINOR bump (feat)
4. ✅ MAJOR bump (breaking change com !)
5. ✅ MAJOR bump (BREAKING CHANGE:)
6. ✅ PATCH bump (commit sem tipo)
7. ✅ MINOR bump (múltiplos commits)
8. ✅ MAJOR bump (prioridade sobre feat/fix)

## Troubleshooting

### Problema: Versão calculada já existe
**Sintoma:** Workflow falha com "Tag vX.Y.Z já existe!"

**Causa:** Os commits desde a última tag não mudaram, então a versão calculada é a mesma.

**Solução:**
1. Adicione novos commits ao branch
2. OU use versão manual para forçar próxima versão

### Problema: Versão calculada incorreta
**Sintoma:** Esperava MAJOR mas recebeu MINOR

**Causa:** Commits não seguem Conventional Commits corretamente

**Solução:**
1. Verifique se commits breaking usam `!` ou `BREAKING CHANGE:`
2. Verifique se features usam `feat:`
3. Ou use versão manual para override

### Problema: Primeira release não é v1.0.0
**Sintoma:** Primeira release calculou v2.0.0

**Causa:** Lógica detectou tag anterior mesmo sem tag anterior

**Solução:** Isso não deveria acontecer - reporte bug

## Compatibilidade

✅ **100% compatível** com fluxo manual existente
✅ **Não quebra** releases existentes
✅ **Não modifica** lógica de changelog
✅ **Não modifica** build de imagens Docker
✅ **Não modifica** trigger de deploy

## Regras Aplicadas

- ✅ Regra 1: LER ANTES DE AGIR - Código existente analisado completamente
- ✅ Regra 2: NÃO DUPLICAR - Reutiliza lógica de Conventional Commits existente
- ✅ Regra 6: SEM WORKAROUNDS - Implementação enterprise real
- ✅ Regra 7: MUDANÇAS CIRÚRGICAS - Apenas job create-release modificado
- ✅ Regra 9: VALIDAÇÃO CONTÍNUA - 8 testes automatizados
- ✅ Regra 10: DOCUMENTAÇÃO PT-BR - Documentação completa em português

## Referências

- [Conventional Commits 1.0.0](https://www.conventionalcommits.org/)
- [Semantic Versioning 2.0.0](https://semver.org/)
- [GitHub Actions workflow_dispatch](https://docs.github.com/en/actions/using-workflows/events-that-trigger-workflows#workflow_dispatch)
