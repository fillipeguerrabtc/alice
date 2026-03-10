import { type ComponentProps, type FormEventHandler } from 'react';
import { motion } from 'framer-motion';
import { ChatInput } from './ChatInput';

type ChatInputProps = ComponentProps<typeof ChatInput>;

type ChatComposerSectionProps = {
  onSubmit: FormEventHandler<HTMLFormElement>;
} & ChatInputProps;

export function ChatComposerSection({
  onSubmit,
  ...chatInputProps
}: ChatComposerSectionProps) {
  return (
    <motion.form
      onSubmit={onSubmit}
      className="p-2 md:p-4 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 safe-area-inset-bottom"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <ChatInput {...chatInputProps} />
    </motion.form>
  );
}
