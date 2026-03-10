import { type ComponentProps } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import * as VisuallyHidden from '@radix-ui/react-visually-hidden';
import { ConversationsList } from './ConversationsList';

const sidebarVariants = {
  hidden: { x: -300, opacity: 0 },
  visible: { x: 0, opacity: 1, transition: { type: 'spring' as const, stiffness: 100 } },
  exit: { x: -300, opacity: 0 },
} as const;

type ConversationsListProps = ComponentProps<typeof ConversationsList>;

type ChatConversationsSidebarProps = {
  conversationsListProps: ConversationsListProps;
  isMobile: boolean;
  mobileDrawerOpen: boolean;
  onMobileDrawerOpenChange: (open: boolean) => void;
  sidebarOpen: boolean;
};

export function ChatConversationsSidebar({
  conversationsListProps,
  isMobile,
  mobileDrawerOpen,
  onMobileDrawerOpenChange,
  sidebarOpen,
}: ChatConversationsSidebarProps) {
  if (isMobile) {
    return (
      <Sheet open={mobileDrawerOpen} onOpenChange={onMobileDrawerOpenChange}>
        <SheetContent side="left" className="w-[300px] p-0">
          <VisuallyHidden.Root>
            <SheetTitle>Conversas</SheetTitle>
          </VisuallyHidden.Root>
          <div className="flex flex-col h-full bg-muted/30">
            <ConversationsList {...conversationsListProps} />
          </div>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <AnimatePresence>
      {sidebarOpen && (
        <motion.div
          variants={sidebarVariants}
          initial="hidden"
          animate="visible"
          exit="exit"
          className="w-64 border-r bg-muted/30 flex flex-col"
        >
          <ConversationsList {...conversationsListProps} />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
