import { describe, expect, it } from 'vitest';
import { shouldDeferConversationMessagesSync } from './useChatMessageSyncEffects';

describe('shouldDeferConversationMessagesSync', () => {
  it('returns false when there is no optimistic guard', () => {
    expect(shouldDeferConversationMessagesSync({
      conversationId: 'conv-1',
      optimisticConversationSyncState: null,
      serverMessagesCount: 0,
    })).toBe(false);
  });

  it('returns true when the optimistic guard matches and the server has not caught up yet', () => {
    expect(shouldDeferConversationMessagesSync({
      conversationId: 'conv-1',
      optimisticConversationSyncState: {
        conversationId: 'conv-1',
        minimumMessageCount: 2,
      },
      serverMessagesCount: 0,
    })).toBe(true);
  });

  it('returns false when the server has already reached the expected message count', () => {
    expect(shouldDeferConversationMessagesSync({
      conversationId: 'conv-1',
      optimisticConversationSyncState: {
        conversationId: 'conv-1',
        minimumMessageCount: 2,
      },
      serverMessagesCount: 2,
    })).toBe(false);
  });

  it('returns false when the guard belongs to another conversation', () => {
    expect(shouldDeferConversationMessagesSync({
      conversationId: 'conv-2',
      optimisticConversationSyncState: {
        conversationId: 'conv-1',
        minimumMessageCount: 2,
      },
      serverMessagesCount: 0,
    })).toBe(false);
  });
});
