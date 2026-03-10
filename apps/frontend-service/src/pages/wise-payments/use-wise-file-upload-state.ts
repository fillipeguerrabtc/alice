import { useCallback, useState } from 'react';

type WiseFilePayload = {
  contentType: string;
  fileBase64: string;
  fileName: string;
};

type UseWiseFileUploadStateResult = {
  disputeUpload: WiseFilePayload;
  handleDisputeFileChange: (file: File | null) => Promise<void>;
  handleKycDocumentChange: (file: File | null, type: 'document' | 'additional') => Promise<void>;
  kycUploadAdditional: WiseFilePayload;
  kycUploadDocument: WiseFilePayload;
};

const EMPTY_FILE_PAYLOAD: WiseFilePayload = {
  contentType: '',
  fileBase64: '',
  fileName: '',
};

async function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error('Falha ao ler arquivo'));
        return;
      }
      const base64 = result.includes(',') ? result.split(',')[1] : result;
      resolve(base64);
    };
    reader.onerror = () => reject(new Error('Falha ao ler arquivo'));
    reader.readAsDataURL(file);
  });
}

export function useWiseFileUploadState(): UseWiseFileUploadStateResult {
  const [disputeUpload, setDisputeUpload] = useState<WiseFilePayload>(EMPTY_FILE_PAYLOAD);
  const [kycUploadDocument, setKycUploadDocument] = useState<WiseFilePayload>(EMPTY_FILE_PAYLOAD);
  const [kycUploadAdditional, setKycUploadAdditional] = useState<WiseFilePayload>(EMPTY_FILE_PAYLOAD);

  const handleDisputeFileChange = useCallback(async (file: File | null) => {
    if (!file) {
      setDisputeUpload(EMPTY_FILE_PAYLOAD);
      return;
    }

    const base64 = await readFileAsBase64(file);
    setDisputeUpload({
      contentType: file.type || 'application/octet-stream',
      fileBase64: base64,
      fileName: file.name,
    });
  }, []);

  const handleKycDocumentChange = useCallback(async (file: File | null, type: 'document' | 'additional') => {
    if (!file) {
      if (type === 'document') {
        setKycUploadDocument(EMPTY_FILE_PAYLOAD);
      } else {
        setKycUploadAdditional(EMPTY_FILE_PAYLOAD);
      }
      return;
    }

    const base64 = await readFileAsBase64(file);
    const payload: WiseFilePayload = {
      contentType: file.type || 'application/octet-stream',
      fileBase64: base64,
      fileName: file.name,
    };
    if (type === 'document') {
      setKycUploadDocument(payload);
      return;
    }
    setKycUploadAdditional(payload);
  }, []);

  return {
    disputeUpload,
    handleDisputeFileChange,
    handleKycDocumentChange,
    kycUploadAdditional,
    kycUploadDocument,
  };
}
