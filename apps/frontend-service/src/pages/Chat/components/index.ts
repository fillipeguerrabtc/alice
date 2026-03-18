/**
 * Chat Components Barrel Export
 * 
 * Re-exporta todos os componentes do Chat.
 * 
 * @module Chat/components
 */

export * from './types';
export { AudioPlayer } from './AudioPlayer';
// REMOVIDO 23/12/2025: VideoPlayer desabilitado (muito pesado para GPU)
export { InlineImage } from './InlineImage';
export { InlineMediaAttachment } from './InlineMediaAttachment';
export { MessageBubble } from './MessageBubble';
export { ConversationItem } from './ConversationItem';
export { ConversationsList } from './ConversationsList';
export { MediaPreview } from './MediaPreview';
export { WelcomeScreen } from './WelcomeScreen';
export { ChatInput } from './ChatInput';
export { AgentStatusBadge } from './AgentStatusBadge';
export { MessageActions } from './MessageActions';
export { ChatActionsMenu } from './ChatActionsMenu';
export { ChatGovernanceControls } from './ChatGovernanceControls';
export { ChatDialogsSection } from './ChatDialogsSection';
export { ChatMessagesViewport } from './ChatMessagesViewport';
export { ChatHeaderSection } from './ChatHeaderSection';
export { ChatConversationsSidebar } from './ChatConversationsSidebar';
export { ChatComposerSection } from './ChatComposerSection';
export { ChatPageLayout } from './ChatPageLayout';
