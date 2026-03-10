import { useCallback, useState } from 'react';
import { motion } from 'framer-motion';
import { Loader2, Upload } from 'lucide-react';
import { cn } from '@/lib/utils';

type UploadZoneProps = {
  disabled: boolean;
  isUploading: boolean;
  onUpload: (file: File) => void;
  t: (key: string) => string;
};

export function UploadZone({
  disabled,
  isUploading,
  onUpload,
  t,
}: UploadZoneProps) {
  const [isDragging, setIsDragging] = useState(false);

  const handleDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    setIsDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) {
      onUpload(file);
    }
  }, [onUpload]);

  const handleFileChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      onUpload(file);
    }
  }, [onUpload]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        'border-2 border-dashed rounded-lg p-5 sm:p-6 text-center transition-colors',
        isDragging ? 'border-primary bg-primary/5' : 'border-muted-foreground/25 hover:border-primary/50',
        (isUploading || disabled) && 'opacity-50 pointer-events-none'
      )}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <input
        type="file"
        id="file-upload"
        className="hidden"
        onChange={handleFileChange}
        accept=".txt,.md,.pdf,.docx,.csv,.json"
        disabled={isUploading || disabled}
      />
      <label htmlFor="file-upload" className="cursor-pointer">
        <div className="flex flex-col items-center gap-3">
          {isUploading ? (
            <Loader2 className="h-10 w-10 text-primary animate-spin" />
          ) : disabled ? (
            <div className="p-3 rounded-full bg-muted">
              <Upload className="h-6 w-6 text-muted-foreground" />
            </div>
          ) : (
            <div className="p-3 rounded-full bg-primary/10">
              <Upload className="h-6 w-6 text-primary" />
            </div>
          )}
          <div>
            <p className="font-medium">
              {isUploading
                ? t('documents.uploadZone.sending')
                : disabled
                  ? t('documents.uploadZone.selectNamespaceFirst')
                  : t('documents.uploadZone.dragOrClick')}
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              {t('documents.uploadZone.supportedTypes')}
            </p>
          </div>
        </div>
      </label>
    </motion.div>
  );
}
