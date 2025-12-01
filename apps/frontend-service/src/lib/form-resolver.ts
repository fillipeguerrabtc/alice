/**
 * Helper para zodResolver compatível com react-hook-form 7.53.1
 * 
 * Esta versão usa tipagem simplificada que funciona com a versão estável
 * do react-hook-form (pré-reescrita DeepPartial).
 * 
 * @see https://github.com/microsoft/TypeScript/issues/34933
 */

import { zodResolver } from '@hookform/resolvers/zod';
import type { ZodType } from 'zod';

/**
 * Wrapper para zodResolver com tipagem simplificada
 * Evita o erro TS2589 usando any no retorno
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createZodResolver<T>(schema: ZodType<T>): any {
  return zodResolver(schema);
}
