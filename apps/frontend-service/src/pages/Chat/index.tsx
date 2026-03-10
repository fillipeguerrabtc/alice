import { ChatPageLayout } from './components/ChatPageLayout';
import { useChatPageLayoutController } from './useChatPageLayoutController';

export default function Chat() {
  const chatPageLayoutProps = useChatPageLayoutController();
  return <ChatPageLayout {...chatPageLayoutProps} />;
}
