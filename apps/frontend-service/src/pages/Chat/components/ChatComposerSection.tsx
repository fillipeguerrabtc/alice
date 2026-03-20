import { type ComponentProps, type FormEventHandler } from 'react';
import { motion } from 'framer-motion';
import { ChatInput } from './ChatInput';

type ChatInputProps = ComponentProps<typeof ChatInput>;

type ChatComposerSectionProps = {
  mode: 'conversation' | 'empty';
  onSubmit: FormEventHandler<HTMLFormElement>;
} & ChatInputProps;

export function ChatComposerSection({
  mode,
  onSubmit,
  ...chatInputProps
}: ChatComposerSectionProps) {
  return (
    <motion.form
      onSubmit={onSubmit}
      className={
        mode === 'empty'
          ? 'safe-area-inset-bottom w-full'
          : 'safe-area-inset-bottom px-2 pb-2 pt-2 md:px-4 md:pb-4 md:pt-3'
      }
      initial={{ opacity: 0, y: mode === 'empty' ? 12 : 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24, ease: 'easeOut' }}
    >
      <ChatInput mode={mode} {...chatInputProps} />
    </motion.form>
  );
}
