import { useCallback, useRef } from 'react';
import type { Route, RouteApplyOptions } from './routes';
import type { DialogDto } from './types';
import type { CommentsController, PrefetchedComments } from './comments-controller';
import type { OpenThreadResult, ThreadController } from './thread-controller';

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
      if (route.view === 'list' || route.view === 'archived') {
        // The archive is a screen of its own: it shows the archived chats, so
        // the open thread closes like it does for the chat list.
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
      let opened: OpenThreadResult | null = null;
      if (!reuse) {
        comments.close();
        // One read covers the window, the chat's slash commands and the
        // post's comments: the engine reads them at the same time, where
        // separate requests would queue behind each other.
        opened = await threads.open(dialog, route.postId === null ? undefined : { postId: route.postId });
        if (ticket !== sequence.current) return;
        page = opened.messages;
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
      // The comments came with the window, so the screen does not ask for
      // them again; an already-open thread has no such read to hand over.
      const prefetched: PrefetchedComments | undefined =
        opened === null
          ? undefined
          : opened.comments === null
            ? { ok: false, error: opened.commentsError ?? 'The comments could not be read' }
            : { ok: true, result: opened.comments };
      await comments.open(dialog.chat, post, prefetched);
    },
    [comments, threads],
  );
}
