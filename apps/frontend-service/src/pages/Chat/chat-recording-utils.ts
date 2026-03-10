const OPENAI_SUPPORTED_AUDIO_MIME_TYPES = new Set([
  'audio/wav',
  'audio/mpeg',
  'audio/mp3',
  'audio/mp4',
  'audio/m4a',
  'audio/x-m4a',
  'audio/aac',
  'audio/flac',
]);

type RecordingPreparationErrorCode = 'conversion' | 'size';

export class RecordingPreparationError extends Error {
  public readonly code: RecordingPreparationErrorCode;

  constructor(code: RecordingPreparationErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

function normalizeMimeType(mimeType: string): string {
  return mimeType.split(';')[0].trim().toLowerCase();
}

function getRecordingExtensionFromMime(mimeType: string): string {
  const normalized = normalizeMimeType(mimeType);
  switch (normalized) {
    case 'audio/ogg':
      return 'ogg';
    case 'audio/wav':
      return 'wav';
    case 'audio/mpeg':
      return 'mp3';
    case 'audio/mp4':
      return 'm4a';
    default:
      return 'webm';
  }
}

function shouldConvertRecordingToWav(mimeType: string): boolean {
  const normalized = normalizeMimeType(mimeType);
  return normalized.length > 0 && !OPENAI_SUPPORTED_AUDIO_MIME_TYPES.has(normalized);
}

function encodeWavFromAudioBuffer(buffer: AudioBuffer): ArrayBuffer {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const dataLength = buffer.length * blockAlign;
  const totalLength = 44 + dataLength;
  const wavBuffer = new ArrayBuffer(totalLength);
  const view = new DataView(wavBuffer);

  let offset = 0;
  const writeString = (value: string) => {
    for (let i = 0; i < value.length; i += 1) {
      view.setUint8(offset, value.charCodeAt(i));
      offset += 1;
    }
  };

  writeString('RIFF');
  view.setUint32(offset, totalLength - 8, true);
  offset += 4;
  writeString('WAVE');
  writeString('fmt ');
  view.setUint32(offset, 16, true);
  offset += 4;
  view.setUint16(offset, 1, true);
  offset += 2;
  view.setUint16(offset, numChannels, true);
  offset += 2;
  view.setUint32(offset, sampleRate, true);
  offset += 4;
  view.setUint32(offset, sampleRate * blockAlign, true);
  offset += 4;
  view.setUint16(offset, blockAlign, true);
  offset += 2;
  view.setUint16(offset, bytesPerSample * 8, true);
  offset += 2;
  writeString('data');
  view.setUint32(offset, dataLength, true);
  offset += 4;

  const channels = Array.from({ length: numChannels }, (_, index) => buffer.getChannelData(index));
  for (let i = 0; i < buffer.length; i += 1) {
    for (let channel = 0; channel < numChannels; channel += 1) {
      const sample = Math.max(-1, Math.min(1, channels[channel][i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }

  return wavBuffer;
}

async function convertRecordingToWav(blob: Blob): Promise<Blob> {
  const AudioContextRef = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextRef) {
    throw new RecordingPreparationError('conversion', 'AudioContext não disponível para conversão');
  }

  const audioContext = new AudioContextRef();
  try {
    const arrayBuffer = await blob.arrayBuffer();
    const decoded = await audioContext.decodeAudioData(arrayBuffer.slice(0));
    const wavBuffer = encodeWavFromAudioBuffer(decoded);
    return new Blob([wavBuffer], { type: 'audio/wav' });
  } catch {
    throw new RecordingPreparationError('conversion', 'Falha ao converter áudio para WAV');
  } finally {
    await audioContext.close().catch(() => null);
  }
}

export async function prepareRecordingFile(
  blob: Blob,
  mimeType: string,
  timestamp: string,
  maxSizeBytes: number
): Promise<File> {
  if (!shouldConvertRecordingToWav(mimeType)) {
    const extension = getRecordingExtensionFromMime(mimeType);
    const fileName = `gravacao-${timestamp}.${extension}`;
    return new File([blob], fileName, { type: mimeType });
  }

  const wavBlob = await convertRecordingToWav(blob);
  if (wavBlob.size > maxSizeBytes) {
    throw new RecordingPreparationError(
      'size',
      'Arquivo de áudio excede o limite após conversão para WAV'
    );
  }

  const fileName = `gravacao-${timestamp}.wav`;
  return new File([wavBlob], fileName, { type: 'audio/wav' });
}
