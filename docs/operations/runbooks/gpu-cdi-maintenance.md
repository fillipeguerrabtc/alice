# Runbook de Manutencao e Reboot do Host GPU

**Author:** Fillipe Guerra
**Data:** 21 de Marco de 2026
**Atualizado:** 21 de Marco de 2026
**Status:** ativo
**Tipo:** runbook

## Objetivo

Definir o procedimento operacional para patch, reboot e diagnostico do host GPU da Alice, com foco em prevenir drift entre driver NVIDIA e CDI antes que `gpu-llm` e `gpu-embeddings` falhem no init do runtime.

## Quando usar

- Antes de reboot planejado do `Production Server`.
- Depois de patch de driver NVIDIA, toolkit ou kernel.
- Quando `gpu-llm` ou `gpu-embeddings` nao sobem apos manutencao.
- Quando `docker logs` parece normal, mas os containers GPU continuam indisponiveis.

## Causa raiz conhecida

- O incidente de 21 de Marco de 2026 ocorreu porque havia um spec CDI persistente e stale em `/etc/cdi/nvidia.yaml`.
- O driver real do host ja estava em `580.126.09`, enquanto o spec legado ainda referenciava bibliotecas `580.95.05`.
- O toolkit moderno gerou corretamente `/var/run/cdi/nvidia.yaml` no reboot, mas o runtime ainda enxergava o arquivo stale em `/etc/cdi`.
- Resultado: falha OCI antes do entrypoint dos containers GPU, com erro de mount em bibliotecas NVIDIA inexistentes.

## Comportamento esperado

- `nvidia-smi` deve responder no host e expor a versao real do driver.
- `/var/run/cdi/nvidia.yaml` deve ser o spec gerado e esperado pelo toolkit.
- `/etc/cdi/nvidia.yaml` nao deve permanecer ativo como fonte persistente para NVIDIA.
- `bash infra/scripts/check-nvidia-runtime.sh` deve passar sem drift.
- `bash infra/scripts/validate-deploy.sh` deve confirmar `alice-gpu-manager`, `gpu-llm` e `gpu-embeddings` saudaveis.

## Checklist antes do reboot

1. Confirmar driver e GPU no host:

```bash
nvidia-smi --query-gpu=name,driver_version --format=csv,noheader
```

2. Validar runtime NVIDIA/CDI sem alterar estado:

```bash
bash infra/scripts/check-nvidia-runtime.sh --skip-docker-gpu-test
```

3. Confirmar que nao existe spec legado ativo em `/etc/cdi/nvidia.yaml`. Se existir, ele deve estar ausente ou no minimo identico ao spec gerado em `/var/run/cdi/nvidia.yaml`.

4. Registrar estado atual dos containers GPU:

```bash
docker ps -a --filter name=gpu-llm --filter name=gpu-embeddings --filter name=alice-gpu-manager
```

5. Opcional para troubleshooting aprofundado:

```bash
nvidia-ctk --debug cdi list
journalctl -u nvidia-cdi-refresh.service -n 100 --no-pager
```

## Checklist depois do reboot

1. Confirmar novamente o driver:

```bash
nvidia-smi --query-gpu=name,driver_version --format=csv,noheader
```

2. Validar fail-fast o runtime NVIDIA/CDI:

```bash
bash infra/scripts/check-nvidia-runtime.sh
```

3. Validar o serving GPU real e os containers criticos:

```bash
bash infra/scripts/validate-deploy.sh --verbose
```

4. Se houver falha apenas nos containers GPU, inspecionar o estado deles antes de confiar em logs antigos:

```bash
docker inspect gpu-llm --format 'status={{.State.Status}} exit={{.State.ExitCode}} error={{.State.Error}}'
docker inspect gpu-embeddings --format 'status={{.State.Status}} exit={{.State.ExitCode}} error={{.State.Error}}'
```

## Como identificar drift entre driver e CDI

1. Coletar a versao real do driver:

```bash
nvidia-smi --query-gpu=driver_version --format=csv,noheader | head -n1
```

2. Ver quais versoes aparecem nos specs CDI:

```bash
grep -oE 'lib[^"[:space:]]*_nvidia\.so\.[0-9.]+' /var/run/cdi/nvidia.yaml | sed -E 's#.*\.so\.##' | sort -u
grep -oE 'lib[^"[:space:]]*_nvidia\.so\.[0-9.]+' /etc/cdi/nvidia.yaml | sed -E 's#.*\.so\.##' | sort -u
```

3. Interpretacao:

- Se `/var/run/cdi/nvidia.yaml` referencia a mesma versao do driver, o spec gerado esta correto.
- Se `/etc/cdi/nvidia.yaml` referencia versao diferente, existe drift persistente e o runtime pode tentar montar bibliotecas antigas.
- Se `cmp -s /etc/cdi/nvidia.yaml /var/run/cdi/nvidia.yaml` falhar, existe divergencia entre spec persistente e spec gerado.

## Procedimento recomendado quando houver drift

1. Nao confiar em `docker compose up` como tentativa cega de recuperacao.
2. Reconciliar explicitamente o runtime Docker e o CDI com o script do repositorio:

```bash
sudo bash infra/scripts/check-nvidia-runtime.sh \
  --configure-docker-runtime \
  --refresh-cdi \
  --reconcile-legacy-cdi
```

3. Rodar novamente a validacao completa:

```bash
bash infra/scripts/check-nvidia-runtime.sh
bash infra/scripts/validate-deploy.sh --verbose
```

## Por que `docker logs` pode enganar

- Quando a falha acontece no init do runtime OCI, o processo principal do container nem chega a iniciar.
- Nesse cenario, `docker logs` tende a mostrar apenas a ultima execucao saudavel, porque nao houve novo stdout/stderr do entrypoint.
- A fonte de verdade passa a ser `docker inspect`, especialmente `.State.Status`, `.State.ExitCode` e `.State.Error`.
- Para o toolkit, o diagnostico complementar vem de `journalctl -u nvidia-cdi-refresh.service` e `nvidia-ctk --debug cdi list`.

## Referencias

- [../deploy.md](../deploy.md)
- [../servers.md](../servers.md)
- [../../architecture/gpu-manager.md](../../architecture/gpu-manager.md)
