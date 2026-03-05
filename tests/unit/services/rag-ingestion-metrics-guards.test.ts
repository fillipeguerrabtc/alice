import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

function read(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), 'utf-8');
}

describe('rag ingestion metrics guards', () => {
  it('keeps ingestion metrics registered in rag service', () => {
    const source = read('apps/rag-service/src/index.ts');
    expect(source.includes("name: 'alice_rag_ingestion_job_total'")).toBe(true);
    expect(source.includes("name: 'alice_rag_ingestion_latency_seconds'")).toBe(true);
    expect(source.includes("name: 'alice_rag_ingestion_deduped_total'")).toBe(true);
  });

  it('keeps queue dedupe observer and worker completion observer wiring', () => {
    const indexSource = read('apps/rag-service/src/index.ts');
    const queueSource = read('apps/rag-service/src/document-processing-queue.ts');
    const workerSource = read('apps/rag-service/src/workers/document-processing-worker.ts');

    expect(indexSource.includes('setDocumentProcessingQueueMetricObserver')).toBe(true);
    expect(indexSource.includes("ragIngestionJobTotal.inc({ status: 'queued' })")).toBe(true);
    expect(indexSource.includes('onJobFinished')).toBe(true);
    expect(indexSource.includes('ragIngestionLatency.observe')).toBe(true);

    expect(queueSource.includes("queueMetricObserver?.('deduped')")).toBe(true);
    expect(queueSource.includes("queueMetricObserver?.('enqueued')")).toBe(true);

    expect(workerSource.includes("status: 'completed'")).toBe(true);
    expect(workerSource.includes("status: 'failed'")).toBe(true);
    expect(workerSource.includes('config.onJobFinished?.({')).toBe(true);
  });
});
