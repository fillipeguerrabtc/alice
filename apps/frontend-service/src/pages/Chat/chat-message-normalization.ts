import type { Message, MediaAttachment } from './components/types';

export type ServerMessagePayload = Partial<Message> & {
  conteudo?: string | null;
  criadoEm?: string | null;
  isFromUser?: boolean | null;
};

type MessageUserSnapshotInput = {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  preferredName?: string | null;
  email?: string | null;
} | null | undefined;

export function buildMessageUserSnapshot(user: MessageUserSnapshotInput): Message['user'] {
  if (!user) {
    return null;
  }
  return {
    id: user.id,
    firstName: user.firstName ?? null,
    lastName: user.lastName ?? null,
    preferredName: user.preferredName ?? null,
    email: user.email ?? null,
    profileImageUrl: null,
  };
}

export function mapAnexosToMediaAttachments(anexos: Message['anexos']): MediaAttachment[] {
  if (!anexos || anexos.length === 0) {
    return [];
  }
  return anexos.map((anexo) => ({
    id: anexo.id,
    type: anexo.type,
    url: anexo.url || '',
    fileName: anexo.filename,
    fileSize: anexo.size ?? 0,
    mimeType: anexo.mimeType,
    status: anexo.url ? 'ready' : 'processing',
    thumbnailUrl: anexo.thumbnailUrl,
    transcription: anexo.transcription,
    uploadId: anexo.uploadId,
    visionDescription: anexo.visionDescription,
    visionModel: anexo.visionModel,
  }));
}

export function normalizeServerMessage(
  message: ServerMessagePayload,
  options: {
    fallbackUser: Message['user'];
    fallbackAgent: Message['agent'];
  },
): Message {
  const { fallbackUser, fallbackAgent } = options;
  const role = message.role ?? (message.isFromUser ? 'user' : 'assistant');
  const content = message.content ?? message.conteudo ?? '';
  const createdAt = message.createdAt ?? message.criadoEm ?? new Date().toISOString();
  const hasExplicitUser = Object.prototype.hasOwnProperty.call(message, 'user');
  const hasExplicitAgent = Object.prototype.hasOwnProperty.call(message, 'agent');
  const mediaAttachments = message.mediaAttachments && message.mediaAttachments.length > 0
    ? message.mediaAttachments
    : message.anexos && message.anexos.length > 0
      ? mapAnexosToMediaAttachments(message.anexos)
      : undefined;

  return {
    ...message,
    role,
    content,
    createdAt,
    mediaAttachments,
    user: role === 'user'
      ? (hasExplicitUser ? message.user ?? null : fallbackUser)
      : (hasExplicitUser ? message.user ?? null : null),
    agent: role === 'assistant'
      ? (hasExplicitAgent ? message.agent ?? null : fallbackAgent)
      : (hasExplicitAgent ? message.agent ?? null : null),
  } as Message;
}
