import { z } from 'zod';
import { ROLE_VALUES } from '@/pages/users-admin/types';

export const groupFormSchema = z.object({
  nome: z.string().min(2, 'Nome deve ter pelo menos 2 caracteres').max(255),
  descricao: z.string().optional(),
  ativo: z.boolean().optional(),
});

export type GroupFormData = z.infer<typeof groupFormSchema>;

export const customRoleFormSchema = z.object({
  nome: z.string().min(2, 'Nome deve ter pelo menos 2 caracteres').max(255),
  slug: z.string().min(2, 'Slug deve ter pelo menos 2 caracteres').max(100).optional(),
  descricao: z.string().optional(),
  baseRole: z.enum(ROLE_VALUES),
  ativo: z.boolean().optional(),
});

export type CustomRoleFormData = z.infer<typeof customRoleFormSchema>;

export const permissionFormSchema = z.object({
  nome: z.string().min(2, 'Nome deve ter pelo menos 2 caracteres').max(255),
  descricao: z.string().optional(),
  modulo: z.string().min(2, 'Módulo é obrigatório').max(100),
  recurso: z.string().min(2, 'Recurso é obrigatório').max(100),
  acao: z.string().min(2, 'Ação é obrigatória').max(50),
});

export type PermissionFormData = z.infer<typeof permissionFormSchema>;

export function parsePermissionCode(code: string): { modulo: string; recurso: string; acao: string } {
  const [modulo = '', recurso = '', acao = 'read'] = code.split(':');
  return { modulo, recurso, acao };
}

export function normalizePermissionToken(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '');
}

export function buildPermissionCode(modulo: string, recurso: string, acao: string): string {
  const normalizedModulo = normalizePermissionToken(modulo);
  const normalizedRecurso = normalizePermissionToken(recurso);
  const normalizedAcao = normalizePermissionToken(acao);
  return `${normalizedModulo}:${normalizedRecurso}:${normalizedAcao}`;
}

export function buildRoleSlug(name: string, slug?: string): string {
  const source = slug?.trim() ? slug : name;
  return normalizePermissionToken(source);
}

export function buildPermissionPayload(values: PermissionFormData) {
  const normalizedModulo = normalizePermissionToken(values.modulo);
  return {
    codigo: buildPermissionCode(values.modulo, values.recurso, values.acao),
    nome: values.nome,
    descricao: values.descricao,
    modulo: normalizedModulo,
  };
}

export function buildCustomRolePayload(values: CustomRoleFormData) {
  return {
    nome: values.nome,
    slug: buildRoleSlug(values.nome, values.slug),
    descricao: values.descricao,
    baseRole: values.baseRole,
    ativo: values.ativo ?? true,
  };
}
