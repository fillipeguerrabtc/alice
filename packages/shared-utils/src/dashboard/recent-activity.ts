type AuditActivityCategory =
  | 'conversation'
  | 'document'
  | 'training'
  | 'routing'
  | 'governance'
  | 'integration'
  | 'system';

type AuditActivitySeverity = 'info' | 'success' | 'warning' | 'critical';

export type HumanizedAuditActivity = {
  title: string;
  description: string;
  category: AuditActivityCategory;
  severity: AuditActivitySeverity;
  href: string | null;
};

type HumanizeAuditActivityInput = {
  action: string;
  resource: string;
  resourceId?: string | null;
  details?: Record<string, unknown> | null;
};

function normalizeValue(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function resolveHref(resource: string): string | null {
  const normalized = normalizeValue(resource);

  if (normalized.includes('training') || normalized.includes('fine_tuning')) {
    return '/training';
  }

  if (normalized.includes('document')) {
    return '/documents';
  }

  if (normalized.includes('image')) {
    return '/images';
  }

  if (
    normalized.includes('namespace')
    || normalized.includes('agent')
    || normalized.includes('routing')
    || normalized.includes('fallback')
  ) {
    return '/namespaces';
  }

  if (normalized.includes('conversation') || normalized.includes('takeover') || normalized.includes('handoff')) {
    return '/conversations';
  }

  if (normalized.includes('user') || normalized.includes('role') || normalized.includes('group')) {
    return '/users';
  }

  if (normalized.includes('trading')) {
    return '/trading';
  }

  if (
    normalized.includes('stripe')
    || normalized.includes('wise')
    || normalized.includes('integration')
    || normalized.includes('webhook')
  ) {
    return '/integrations';
  }

  return null;
}

function resolveCategory(resource: string, action: string): AuditActivityCategory {
  const normalizedResource = normalizeValue(resource);
  const normalizedAction = normalizeValue(action);

  if (normalizedResource.includes('training') || normalizedResource.includes('fine_tuning')) return 'training';
  if (normalizedResource.includes('document')) return 'document';
  if (normalizedResource.includes('image')) return 'document';
  if (
    normalizedResource.includes('namespace')
    || normalizedResource.includes('agent')
    || normalizedResource.includes('routing')
    || normalizedAction.includes('fallback')
  ) {
    return 'routing';
  }
  if (normalizedResource.includes('conversation') || normalizedResource.includes('takeover') || normalizedResource.includes('handoff')) {
    return 'conversation';
  }
  if (normalizedResource.includes('user') || normalizedResource.includes('role') || normalizedResource.includes('group')) {
    return 'governance';
  }
  if (
    normalizedResource.includes('stripe')
    || normalizedResource.includes('wise')
    || normalizedResource.includes('integration')
    || normalizedResource.includes('trading')
    || normalizedResource.includes('webhook')
  ) {
    return 'integration';
  }
  return 'system';
}

function resolveSeverity(action: string): AuditActivitySeverity {
  const normalized = normalizeValue(action);

  if (
    normalized.includes('fail')
    || normalized.includes('error')
    || normalized.includes('reject')
    || normalized.includes('breach')
  ) {
    return 'critical';
  }

  if (
    normalized.includes('warning')
    || normalized.includes('fallback')
    || normalized.includes('review')
    || normalized.includes('pending')
  ) {
    return 'warning';
  }

  if (
    normalized.includes('create')
    || normalized.includes('upload')
    || normalized.includes('approve')
    || normalized.includes('complete')
    || normalized.includes('start')
    || normalized.includes('promote')
  ) {
    return 'success';
  }

  return 'info';
}

function buildTitle(resource: string, action: string, details?: Record<string, unknown> | null): string {
  const normalizedResource = normalizeValue(resource);
  const normalizedAction = normalizeValue(action);
  const detailReason = typeof details?.reason === 'string' ? details.reason.trim().toLowerCase() : '';

  if (normalizedResource.includes('training') || normalizedResource.includes('fine_tuning')) {
    if (normalizedAction.includes('start')) return 'Treinamento iniciado';
    if (normalizedAction.includes('complete')) return 'Treinamento concluído';
    if (normalizedAction.includes('fail') || normalizedAction.includes('error')) return 'Treinamento com falha';
    if (normalizedAction.includes('approve')) return 'Treinamento aprovado';
    return 'Treinamento solicitado';
  }

  if (normalizedResource.includes('document')) {
    if (normalizedAction.includes('delete')) return 'Documento removido';
    if (normalizedAction.includes('update')) return 'Documento atualizado';
    return 'Documento enviado';
  }

  if (normalizedResource.includes('image')) {
    if (normalizedAction.includes('approve')) return 'Imagem aprovada para training';
    return 'Imagem processada';
  }

  if (
    normalizedResource.includes('namespace')
    || normalizedResource.includes('agent')
    || normalizedAction.includes('fallback')
  ) {
    if (detailReason.includes('namespace_unmapped') || normalizedAction.includes('fallback')) {
      return 'Fallback sem namespace detectado';
    }
    if (normalizedAction.includes('review')) return 'Roteamento enviado para revisão';
    return 'Configuração de roteamento atualizada';
  }

  if (normalizedResource.includes('conversation') || normalizedResource.includes('takeover') || normalizedResource.includes('handoff')) {
    if (normalizedAction.includes('takeover') || normalizedAction.includes('handoff')) return 'Handoff solicitado';
    if (normalizedAction.includes('resolve') || normalizedAction.includes('close')) return 'Atendimento encerrado';
    return 'Conversa atualizada';
  }

  if (normalizedResource.includes('user')) {
    if (normalizedAction.includes('delete')) return 'Usuário removido';
    if (normalizedAction.includes('update')) return 'Usuário atualizado';
    return 'Usuário adicionado';
  }

  if (normalizedResource.includes('group')) {
    return 'Grupo atualizado';
  }

  if (normalizedResource.includes('role')) {
    return 'Permissões atualizadas';
  }

  if (normalizedResource.includes('trading')) {
    return 'Evento de trading registrado';
  }

  if (
    normalizedResource.includes('stripe')
    || normalizedResource.includes('wise')
    || normalizedResource.includes('integration')
    || normalizedResource.includes('webhook')
  ) {
    return 'Integração atualizada';
  }

  return 'Atividade registrada';
}

function buildDescription(resource: string, resourceId?: string | null): string {
  const normalizedResource = normalizeValue(resource);
  const suffix = resourceId ? ` (${resourceId})` : '';

  if (normalizedResource.includes('training') || normalizedResource.includes('fine_tuning')) {
    return `Mudança registrada no fluxo de treinamento${suffix}.`;
  }

  if (normalizedResource.includes('document')) {
    return `Mudança registrada no acervo de documentos${suffix}.`;
  }

  if (normalizedResource.includes('image')) {
    return `Mudança registrada na galeria de imagens${suffix}.`;
  }

  if (
    normalizedResource.includes('namespace')
    || normalizedResource.includes('agent')
    || normalizedResource.includes('routing')
    || normalizedResource.includes('fallback')
  ) {
    return `Mudança registrada no roteamento operacional${suffix}.`;
  }

  if (normalizedResource.includes('conversation') || normalizedResource.includes('takeover') || normalizedResource.includes('handoff')) {
    return `Mudança registrada no fluxo de atendimento${suffix}.`;
  }

  if (normalizedResource.includes('user') || normalizedResource.includes('role') || normalizedResource.includes('group')) {
    return `Mudança registrada na governança de acesso${suffix}.`;
  }

  if (
    normalizedResource.includes('stripe')
    || normalizedResource.includes('wise')
    || normalizedResource.includes('integration')
    || normalizedResource.includes('trading')
    || normalizedResource.includes('webhook')
  ) {
    return `Mudança registrada em integração operacional${suffix}.`;
  }

  return `Evento registrado na plataforma${suffix}.`;
}

export function humanizeAuditActivity(input: HumanizeAuditActivityInput): HumanizedAuditActivity {
  return {
    title: buildTitle(input.resource, input.action, input.details),
    description: buildDescription(input.resource, input.resourceId),
    category: resolveCategory(input.resource, input.action),
    severity: resolveSeverity(input.action),
    href: resolveHref(input.resource),
  };
}
