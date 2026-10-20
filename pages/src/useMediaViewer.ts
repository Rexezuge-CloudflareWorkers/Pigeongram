import { useCallback, useRef, useState } from 'react';
import { groupMessages } from './groups';
import type { ChatThread, CommentsThread } from './state';
import type { MessageDto } from './types';

/**
 * The full-page media viewer's state.
 *
 * The viewer belongs to the app rather than to a bubble so it can own a
 * browser-history layer: back closes the viewer instead of leaving the chat.
 * Only the source and message id are kept; the display group is derived from
 * the live thread/comments window on every render, so an edit that arrives
 * while the viewer is open is reflected in it.
 */

export type ViewerSource = 'thread' | 'comments';

interface ViewerRequest {
  source: ViewerSource;
  messageId: number;
}

export interface MediaViewerController {
  viewer: { messages: readonly MessageDto[]; initialMessageId: number } | null;
  open: (source: ViewerSource, messageId: number) => void;
  close: () => void;
  /**
   * Re-opens the last request, for browser forward into a viewer entry.
   */
  reopen: () => void;
}

interface UseMediaViewerOptions {
  thread: ChatThread | null;
  comments: CommentsThread | null;
}

export function useMediaViewer({ thread, comments }: UseMediaViewerOptions): MediaViewerController {
  const [request, setRequest] = useState<ViewerRequest | null>(null);
  // Forward over a closed viewer entry has no payload in `history.state`; the
  // last request is enough to put the same media back while the tab lives.
  const lastRequest = useRef<ViewerRequest | null>(null);

  const open = useCallback((source: ViewerSource, messageId: number): void => {
    const next = { source, messageId };
    lastRequest.current = next;
    setRequest(next);
  }, []);

  const close = useCallback((): void => {
    setRequest(null);
  }, []);

  const reopen = useCallback((): void => {
    if (lastRequest.current !== null) setRequest(lastRequest.current);
  }, []);

  const messages =
    request === null
      ? null
      : request.source === 'thread'
        ? thread === null
          ? null
          : groupOf(thread.messages, request.messageId)
        : comments === null
          ? null
          : groupOf([comments.post, ...comments.comments], request.messageId);

  return {
    viewer: request !== null && messages !== null ? { messages, initialMessageId: request.messageId } : null,
    open,
    close,
    reopen,
  };
}

function groupOf(messages: readonly MessageDto[], messageId: number): MessageDto[] | null {
  return groupMessages(messages).find((group) => group.some((message) => message.id === messageId)) ?? null;
}
