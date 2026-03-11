import { Counter, Gauge, Histogram, type Registry } from 'prom-client';

export function createGpuManagerMetrics(registry: Registry) {
  const gpuVramTotalBytes = new Gauge({
    name: 'alice_gpu_vram_total_bytes',
    help: 'VRAM total da GPU em bytes (fonte: nvidia-smi quando disponível)',
    labelNames: ['gpu_id'] as const,
    registers: [registry],
  });

  const gpuVramUsedBytes = new Gauge({
    name: 'alice_gpu_vram_used_bytes',
    help: 'VRAM usada total da GPU em bytes (fonte: nvidia-smi quando disponível)',
    labelNames: ['gpu_id'] as const,
    registers: [registry],
  });

  const gpuManagerVramFreeBytes = new Gauge({
    name: 'gpu_manager_vram_free_bytes',
    help: 'VRAM livre observada pelo GPU Manager em bytes',
    labelNames: ['gpu_id'] as const,
    registers: [registry],
  });

  const gpuVramReservedBytes = new Gauge({
    name: 'alice_gpu_vram_reserved_bytes',
    help: 'VRAM reservada estimada por capacidade (bytes) baseada em serviços ativos e requisitos declarados',
    labelNames: ['gpu_id', 'service'] as const,
    registers: [registry],
  });

  const gpuManagerQueueDepth = new Gauge({
    name: 'alice_gpu_manager_queue_depth',
    help: 'Tamanho atual da fila Redis por capacidade (LLM/embeddings/training)',
    labelNames: ['queue'] as const,
    registers: [registry],
  });

  const gpuManagerQueueWaitDuration = new Histogram({
    name: 'alice_gpu_manager_queue_wait_duration_seconds',
    help: 'Tempo de espera na fila Redis (segundos) por capacidade',
    labelNames: ['queue'] as const,
    buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60, 120],
    registers: [registry],
  });

  const gpuManagerRejectionsTotal = new Counter({
    name: 'gpu_manager_rejections_total',
    help: 'Total de rejeições do admission control/política do GPU Manager',
    labelNames: ['service', 'reason'] as const,
    registers: [registry],
  });

  const gpuOrchestratorTransitionsTotal = new Counter({
    name: 'gpu_orchestrator_transitions_total',
    help: 'Total de transições de estado da FSM de orquestração GPU',
    labelNames: ['from_state', 'to_state', 'trigger', 'outcome'] as const,
    registers: [registry],
  });

  const gpuOrchestratorTransitionDurationSeconds = new Histogram({
    name: 'gpu_orchestrator_transition_duration_seconds',
    help: 'Duração das operações de transição da FSM de orquestração GPU',
    labelNames: ['action', 'trigger', 'outcome'] as const,
    buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 20, 30, 60, 120],
    registers: [registry],
  });

  const gpuOrchestratorState = new Gauge({
    name: 'gpu_orchestrator_state',
    help: 'Estado atual da FSM de orquestração GPU (one-hot por label state)',
    labelNames: ['state'] as const,
    registers: [registry],
  });

  return {
    gpuVramTotalBytes,
    gpuVramUsedBytes,
    gpuManagerVramFreeBytes,
    gpuVramReservedBytes,
    gpuManagerQueueDepth,
    gpuManagerQueueWaitDuration,
    gpuManagerRejectionsTotal,
    gpuOrchestratorTransitionsTotal,
    gpuOrchestratorTransitionDurationSeconds,
    gpuOrchestratorState,
  };
}
