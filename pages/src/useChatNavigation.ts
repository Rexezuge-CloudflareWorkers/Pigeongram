import { useCallback, useRef } from 'react';
import type { Route, RouteApplyOptions } from './routes';
import type { DialogDto } from './types';
import type { CommentsController } from './comments-controller';
import type { ThreadController } from './useThread';

/**
 * Applies a `Route` to the thread and comments controllers.
 *
 * The router owns the URL and history; this hook owns what the screen shows.
 * Keeping the two apart lets the history half stay small and lets the reader
 * see the one non-obvious rule: a chat that is already open is reused, so
 * stepping back from comments does not re-fetch the window or jump the reader
 * back to the unread divider. A Telegram link asks for `force`, which keeps
 * its old "re-read around the linked post" behaviour.
 */

export interface ChatNavigationOptions {
  /**
   * The live dialogs. A ref because `boot` applies the URL immediately after
   * the dialogs fetch resolves, before React has committed them; the route
   * must find its chat in that same tick.
   */
  dialogs: { current: readonly DialogDto[] };
  threads: ThreadController;
  comments: CommentsController;
}

export function useChatNavigation({
  dialogs: dialogsRef,
  threads,
  comments,
}: ChatNavigationOptions): (route: Route, options: RouteApplyOptions) => Promise<void> {
  // Every apply takes a ticket; a slower open that loses to a later back or
  // forward must not put its chat back on screen.
  const sequence = useRef(0);

  return useCallback(
    async (route: Route, options: RouteApplyOptions): Promise<void> => {
      if (route.view === 'list') {
        sequence.current += 1;
        comments.close();
        threads.close();
        return;
      }

      const ticket = ++sequence.current;

      const dialog = dialogsRef.current.find((candidate) => candidate.chat.id === route.chatId);
      if (!dialog) {
        options.replaceTo({ view: 'list' });
        return;
      }

      const open = threads.thread;
      const loadedPost =
        route.postId !== null && open?.chat.id === route.chatId && open.messages.some((message) => message.id === route.postId);
      const reuse = !options.force && open?.chat.id === route.chatId && (route.postId === null || loadedPost);

      let page = reuse && open ? open.messages : null;
      if (!reuse) {
        comments.close();
        page = await threads.open(dialog, route.postId === null ? undefined : { postId: route.postId });
        if (ticket !== sequence.current) return;
      }

      const post = page?.find((message) => message.id === route.postId) ?? null;
      if (route.view === 'chat') {
        // A linked post that the window could not produce (deleted, or a typo
        // in a shared URL) leaves the chat open without a dead post segment.
        if (route.postId !== null && post === null) options.replaceTo({ view: 'chat', chatId: route.chatId, postId: null });
        comments.close();
        return;
      }

      if (post === null) {
        options.replaceTo({ view: 'chat', chatId: route.chatId, postId: null });
        return;
      }
      await comments.open(dialog.chat, post);
    },
    [comments, threads],
  );
}
