/**
 * Helper para resolver a incompatibilidade de tipos entre zodResolver e react-hook-form
 * 
 * O erro TS2589 "Type instantiation is excessively deep and possibly infinite" ocorre
 * quando a combinação react-hook-form 7.55+ com @hookform/resolvers 3.10+ e TypeScript 5.6+
 * tenta expandir os tipos condicionais do Resolver contra schemas complexos.
 * 
 * Este helper erasa os tipos problemáticos antes de passar o resolver para useForm.
 * 
 * @see https://github.com/microsoft/TypeScript/issues/34933
 */

import type { Resolver, FieldValues } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { ZodSchema } from 'zod';

/**
 * Wrapper tipado para zodResolver que evita o erro TS2589
 * 
 * @param schema - Zod schema para validação
 * @returns Resolver compatível com useForm
 * 
 * @example
 * ```ts
 * const form = useForm<MyFormData>({
 *   resolver: createZodResolver(mySchema),
 *   defaultValues: { ... }
 * });
 * ```
 */
export function createZodResolver<TFieldValues extends FieldValues>(
  schema: ZodSchema<TFieldValues>
): Resolver<TFieldValues> {
  return zodResolver(schema) as unknown as Resolver<TFieldValues>;
}
