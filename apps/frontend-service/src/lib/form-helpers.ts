/**
 * Form Helpers - Alice Enterprise Platform
 * 
 * Helpers para formulários react-hook-form com zodResolver.
 * Resolve TS2589 (Type instantiation is excessively deep) ao quebrar
 * a inferência recursiva de tipos do zodResolver.
 * 
 * Documentação em PT-BR (Regra 10 replit.md)
 */

import type { Resolver, FieldValues } from 'react-hook-form';

/**
 * Helper para criar resolver Zod sem causar TS2589.
 * 
 * O TypeScript tenta expandir os tipos genéricos do zodResolver recursivamente,
 * causando "Type instantiation is excessively deep and possibly infinite".
 * Esta função força o tipo Resolver<T> sem deixar o TS expandir os genéricos internos.
 * 
 * @param resolver - O zodResolver já criado
 * @returns O mesmo resolver com tipo Resolver<T> forçado
 * 
 * @example
 * ```tsx
 * import { zodResolver } from '@hookform/resolvers/zod';
 * import { asResolver } from '@/lib/form-helpers';
 * 
 * const form = useForm<MyFormData>({
 *   resolver: asResolver(zodResolver(mySchema)),
 *   defaultValues: { ... }
 * });
 * ```
 */
export function asResolver<T extends FieldValues>(
  resolver: unknown
): Resolver<T> {
  return resolver as Resolver<T>;
}
