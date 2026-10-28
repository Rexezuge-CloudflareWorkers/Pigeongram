import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { fetchChatScreen } from './api';
import { firstUnread } from './reading';
import { mergeMessages } from './state';
import { cachedOpen, mergeCacheRefresh, ThreadCache } from './thread-cache';
import type { OpenThreadResult } from './thread-controller';
import type { ThreadPositionMemory } from './thread-position';
import type { ChatThread } from './thread-state';
import { OPEN_LIMIT, supportsCommands, unreadWindow } from './thread-window';
import type { OpenThreadOptions } from './thread-window';
import type { BotCommandDto, ChatDto, DialogDto } from './types';

/**
 * The opening half of the thread controller: the first read of a chat, the
 * cache a reopen paints from, and the read that revalidates it.
 *
 * Split from `useThread` so the controller keeps the send and update half while
 * this one owns the opening state the view renders — the spinner, the failure,
 * the command menu. The cache is memory only and paints before the server
 * answers; the server stays the truth.
 */

interface UseThreadOpenOptions {
  thread: ChatThread | null;
  setThread: Dispatch<SetStateAction<ChatThread | null>>;
  positions: ThreadPositionMemory;
}

interface ThreadOpening {
  open: (dialog: DialogDto, options?: OpenThreadOptions) => Promise<OpenThreadResult>;
  /**
   * Cancels an open in flight and clears the chat-specific answers, so a close
   * or a newer open cannot be overwritten by a stale read.
   */
  reset: () => void;
  loading: boolean;
  error: string | null;
  setError: (message: string | null) => void;
  botCommands: readonly BotCommandDto[];
  description: string | null;
}

function failureText(failure: unknown): string {
  return failure instanceof Error ? failure.message : String(failure);
}

/**
The empty slash-command menu, before a chat is opened.
*/
const NO_COMMANDS: readonly BotCommandDto[] = [];

export function useThreadOpen({ thread, setThread, positions }: UseThreadOpenOptions): ThreadOpening {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [botCommands, setBotCommands] = useState<readonly BotCommandDto[]>(NO_COMMANDS);
  const [description, setDescription] = useState<string | null>(null);
  const cache = useRef<ThreadCache | null>(null);
  if (cache.current === null) cache.current = new ThreadCache();
  // Every open takes a ticket: a slow read for a chat the reader already left
  // must not paint over the one they are in, and closing cancels too.
  const ticket = useRef(0);

  // The cache follows the open thread: a send, a read or a live message moves
  // the copy a reopen would paint, and `ThreadCache` refuses a window that does
  // not reach the newest message.
  useEffect(() => {
    if (thread !== null) cache.current?.set(thread);
  }, [thread]);

  const reset = useCallback((): void => {
    ticket.current += 1;
    setLoading(false);
    setError(null);
    setBotCommands(NO_COMMANDS);
    setDescription(null);
  }, []);

  /**
  Reads the newest page beside a painted cache entry and folds it in. The same
  read refreshes the commands and description, so a bot's menu is not stale just
  because the window was.
  */
  const refresh = useCallback(
    async (chat: ChatDto, dialog: DialogDto, openingReadInboxMaxId: number, sequence: number): Promise<void> => {
      try {
        const screen = await fetchChatScreen(chat.id, null, {
          limit: OPEN_LIMIT,
          withCommands: supportsCommands(chat.kind),
        });
        if (sequence !== ticket.current) return;
        setBotCommands(screen.commands);
        setDescription(screen.description);
        setThread((current) =>
          current && current.chat.id === chat.id ? mergeCacheRefresh(current, screen.messages, dialog, openingReadInboxMaxId) : current,
        );
      } catch (failure) {
        if (sequence !== ticket.current) return;
        setError(failureText(failure));
      }
    },
    [setThread],
  );

  const open = useCallback(
    async (dialog: DialogDto, options?: OpenThreadOptions): Promise<OpenThreadResult> => {
      const chat = dialog.chat;
      const postId = options?.postId ?? null;
      // A fresh read is a new session: only a comments detour keeps the
      // remembered position, because it leaves this thread open.
      positions.forget();
      const sequence = ++ticket.current;
      // The menu and the empty-chat description belong to the chat being
      // opened, so the previous chat's answer must not survive a failed read.
      setError(null);
      setBotCommands(NO_COMMANDS);
      setDescription(null);

      // A chat with unread messages opens at its own divider, not where the
      // last visit left it, and a linked post has its own landing rule: the
      // cache only serves a plain reopen.
      const cached = postId === null ? (cache.current?.get(chat.id) ?? null) : null;
      const painted = cachedOpen(cached, dialog);
      if (painted !== null) {
        setLoading(false);
        setThread(painted);
        void refresh(chat, dialog, painted.readInboxMaxId, sequence);
        return { messages: painted.messages, comments: null, commentsError: null };
      }

      setThread({
        chat,
        messages: [],
        readInboxMaxId: dialog.readInboxMaxId,
        readOutboxMaxId: dialog.readOutboxMaxId,
        unreadDividerId: null,
        focusMessageId: postId,
        hasMoreOlder: true,
        windowEndId: null,
        latestMessageId: dialog.lastMessage?.id ?? null,
      });
      setLoading(true);
      try {
        // A chat with unread messages opens at where reading stopped, not at
        // the newest page: the watermark anchors a window that reaches a little
        // way back for context and the rest of the page towards the unread
        // side. A large backlog can still extend past that page; forward paging
        // continues from the window's end.
        const unread = postId === null && dialog.unread > 0 ? unreadWindow(dialog.readInboxMaxId) : null;
        // The window, the chat's slash commands and — when a post is named —
        // its comments are one request: the engine reads them at the same
        // time, where separate requests would queue behind each other.
        const screen = await fetchChatScreen(chat.id, postId, {
          limit: OPEN_LIMIT,
          ...(postId !== null && { anchorId: postId }),
          ...(unread !== null && unread),
          withCommands: supportsCommands(chat.kind),
        });
        if (sequence !== ticket.current) return { messages: [], comments: null, commentsError: null };
        setBotCommands(screen.commands);
        setDescription(screen.description);
        const screenEnd = screen.messages.at(-1)?.id ?? null;
        // A live message can arrive while the window is in flight. If the
        // window was at the newest message when it was requested, those
        // messages continue it and are kept; otherwise they sit beyond the
        // backlog and wait for forward paging. An own send is the reader's own
        // action and stays either way, with the gap left for paging to fill;
        // an empty window has no range to be behind, so its messages stay too.
        const openedLatest = dialog.lastMessage?.id ?? null;
        const reachedAtOpen = screenEnd !== null && (openedLatest === null || screenEnd >= openedLatest);
        setThread((current) =>
          current && current.chat.id === chat.id
            ? {
                ...current,
                messages: mergeMessages(
                  screen.messages,
                  current.messages.filter((message) => reachedAtOpen || screenEnd === null || message.outgoing || message.id <= screenEnd),
                ),
                unreadDividerId: firstUnread(screen.messages, dialog.readInboxMaxId)?.id ?? null,
                // A plain read starts at the newest message, so a short window
                // is the whole history. A jump window is anchored mid-history
                // and can be short without being the start, so it always has a
                // page to ask for until one comes back empty.
                hasMoreOlder: postId === null ? screen.messages.length >= OPEN_LIMIT : screen.messages.length > 0,
                windowEndId: reachedAtOpen ? Math.max(screenEnd ?? 0, current.latestMessageId ?? 0) : screenEnd,
              }
            : current,
        );
        return { messages: screen.messages, comments: screen.comments, commentsError: screen.commentsError };
      } catch (failure) {
        if (sequence !== ticket.current) return { messages: [], comments: null, commentsError: failureText(failure) };
        setError(failureText(failure));
        return { messages: [], comments: null, commentsError: failureText(failure) };
      } finally {
        if (sequence === ticket.current) setLoading(false);
      }
    },
    [positions, refresh, setThread],
  );

  return { open, reset, loading, error, setError, botCommands, description };
}
