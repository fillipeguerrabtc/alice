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
 * asResolver: wrapper tipado que preserva a tipagem TFormValues sem forçar o compilador
 * a re-inferir tipos complexos retornados por libs (ex: zodResolver).
 *
 * Uso:
 *   resolver: asResolver<MyFormData>(zodResolver(myZodSchema))
 *
 * Explicação:
 * - Recebe um Resolver já existente e o re-expõe tipado como Resolver<TFormValues>.
 * - Ao fornecer explicitamente TFormValues no chamador, TypeScript NÃO tenta expandir a
 *   estrutura interna do resolver (que é a fonte do estouro de instância de tipo).
 * 
 * IMPORTANTE: O parâmetro DEVE ser Resolver<TFormValues>, NÃO unknown.
 * Usar unknown força o TypeScript a re-inferir o tipo, causando TS2589.
 */
export function asResolver<TFormValues extends FieldValues = FieldValues>(
  resolver: Resolver<TFormValues>
): Resolver<TFormValues> {
  return resolver;
}
