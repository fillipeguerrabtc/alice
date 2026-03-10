import { apiRequest } from '@/lib/queryClient';
import type { MediaAttachment } from './components/types';

export async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Falha ao ler arquivo'));
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error('Falha ao converter arquivo em base64'));
        return;
      }
      const base64 = result.includes(',') ? result.split(',')[1] : result;
      resolve(base64);
    };
    reader.readAsDataURL(file);
  });
}

export async function mediaAttachmentToBase64(media: MediaAttachment): Promise<string> {
  if (media.file) {
    return fileToBase64(media.file);
  }
  if (media.uploadId) {
    const uploadResponse = await apiRequest('GET', `/api/media/uploads/${media.uploadId}`);
    if (!uploadResponse.ok) {
      throw new Error('Falha ao obter informações do upload de mídia');
    }
    const data = await uploadResponse.json() as { upload?: { fileUrl?: string | null } };
    const resolvedUrl = data.upload?.fileUrl;
    if (resolvedUrl) {
      const fileResponse = await fetch(resolvedUrl, { credentials: 'include' });
      if (!fileResponse.ok) {
        throw new Error('Falha ao baixar arquivo de mídia');
      }
      const blob = await fileResponse.blob();
      const file = new File([blob], media.fileName, { type: media.mimeType });
      return fileToBase64(file);
    }
  }
  if (media.url) {
    const response = await fetch(media.url, { credentials: 'include' });
    if (!response.ok) {
      throw new Error('Falha ao baixar arquivo de mídia');
    }
    const blob = await response.blob();
    const file = new File([blob], media.fileName, { type: media.mimeType });
    return fileToBase64(file);
  }
  throw new Error('Arquivo de mídia indisponível para upload');
}
