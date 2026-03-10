import { useCallback, type Dispatch, type SetStateAction } from 'react';
import type { TFunction } from 'i18next';
import { apiRequest } from '@/lib/queryClient';
import { frontendLogger } from '@/lib/logger';
import {
  FILE_LIMITS,
  formatFileSize,
  getMediaType,
  type MediaAttachment,
} from './components/types';

type NotifyFn = (params: {
  title: string;
  description?: string;
  variant?: 'default' | 'destructive';
}) => void;

type UseChatMediaAttachmentActionsOptions = {
  notify: NotifyFn;
  pendingMedia: MediaAttachment[];
  setPendingMedia: Dispatch<SetStateAction<MediaAttachment[]>>;
  t: TFunction;
};

export function useChatMediaAttachmentActions(options: UseChatMediaAttachmentActionsOptions) {
  const { notify, pendingMedia, setPendingMedia, t } = options;

  const revokeMediaUrl = useCallback((media?: MediaAttachment) => {
    if (!media?.url) return;
    if (media.url.startsWith('blob:')) {
      URL.revokeObjectURL(media.url);
    }
  }, []);

  const processSelectedFiles = useCallback(async (files: File[]) => {
    if (!files || files.length === 0) return;

    for (const file of files) {
      const mediaType = getMediaType(file.type);

      if (!mediaType) {
        frontendLogger.warn('Upload rejeitado: tipo não suportado', {
          fileName: file.name,
          mimeType: file.type,
        });
        notify({
          title: t('chat.upload.unsupportedType'),
          description: t('chat.upload.unsupportedTypeDesc', { type: file.type }),
          variant: 'destructive',
        });
        continue;
      }

      const limit = FILE_LIMITS[mediaType];
      if (!limit) {
        frontendLogger.error('Limite não definido para tipo de mídia', {
          fileName: file.name,
          mediaType,
        });
        notify({
          title: t('chat.upload.unsupportedType'),
          description: `Tipo de mídia não suportado: ${mediaType}`,
          variant: 'destructive',
        });
        continue;
      }

      if (file.size > limit) {
        frontendLogger.warn('Upload rejeitado: arquivo muito grande', {
          fileName: file.name,
          fileSize: file.size,
          limit,
        });
        notify({
          title: t('chat.upload.fileTooLarge'),
          description: t('chat.upload.fileTooLargeDesc', {
            size: formatFileSize(file.size),
            limit: formatFileSize(limit),
          }),
          variant: 'destructive',
        });
        continue;
      }

      const objectUrl = URL.createObjectURL(file);
      const mediaId = crypto.randomUUID();
      const newMedia: MediaAttachment = {
        id: mediaId,
        type: mediaType,
        url: objectUrl,
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type,
        status: 'ready',
        file,
      };

      if (mediaType === 'audio') {
        const mediaElement = document.createElement('audio');
        mediaElement.src = objectUrl;
        mediaElement.onloadedmetadata = () => {
          setPendingMedia((previous) =>
            previous.map((media) =>
              media.id === mediaId ? { ...media, duration: mediaElement.duration } : media,
            ),
          );
        };
      }

      if (mediaType === 'image') {
        const img = new Image();
        img.src = objectUrl;
        img.onload = () => {
          setPendingMedia((previous) =>
            previous.map((media) =>
              media.id === mediaId ? { ...media, width: img.width, height: img.height } : media,
            ),
          );
        };
      }

      setPendingMedia((previous) => [...previous, newMedia]);
    }
  }, [notify, setPendingMedia, t]);

  const handleFileSelect = useCallback(async (files: File[]) => {
    if (!files || files.length === 0) return;
    await processSelectedFiles(files);
  }, [processSelectedFiles]);

  const removePendingMedia = useCallback((mediaId: string) => {
    setPendingMedia((previous) => {
      const media = previous.find((entry) => entry.id === mediaId);
      if (media) {
        revokeMediaUrl(media);
        if (media.uploadId) {
          apiRequest('DELETE', `/api/media/uploads/${media.uploadId}`).catch((error) => {
            frontendLogger.warn('Falha ao remover upload de mídia', { error, uploadId: media.uploadId });
          });
        }
      }
      return previous.filter((entry) => entry.id !== mediaId);
    });
  }, [revokeMediaUrl, setPendingMedia]);

  const clearPendingMedia = useCallback((options?: { revokeBlobUrls?: boolean }) => {
    if (options?.revokeBlobUrls !== false) {
      pendingMedia.forEach((media) => revokeMediaUrl(media));
    }
    setPendingMedia([]);
  }, [pendingMedia, revokeMediaUrl, setPendingMedia]);

  return {
    clearPendingMedia,
    handleFileSelect,
    removePendingMedia,
  };
}
