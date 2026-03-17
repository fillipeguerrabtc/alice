/**
 * Tipos customizados internos do schema compartilhado.
 *
 * Esta camada concentra apenas tipos Drizzle/pgvector reutilizados pelo
 * schema principal para reduzir acoplamento no arquivo monolítico.
 *
 * Autor: Fillipe Guerra
 * Data: 17 de Março de 2026
 */

import { customType } from "drizzle-orm/pg-core";

// TEXTO: DEPRECATED - Novos embeddings de texto vão para Qdrant (1024 dim)
// Mantido para compatibilidade com dados existentes.
export const textVector = customType<{ data: number[]; driverData: number[] }>({
  dataType() {
    return 'halfvec(3584)';
  },
});

export const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return 'bytea';
  },
});

// Alias legado para contratos antigos do schema.
export const vector = textVector;

// Pipeline de dedupe de training data usa embeddings 1024 dim.
export const trainingVector1024 = customType<{ data: number[]; driverData: number[] }>({
  dataType() {
    return 'halfvec(1024)';
  },
});

// Embeddings faciais usam 128 dimensões.
export const biometricsVector128 = customType<{ data: number[]; driverData: number[] }>({
  dataType() {
    return 'vector(128)';
  },
});
