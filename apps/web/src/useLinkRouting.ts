import { useCallback } from 'react';
import type { MutableRefObject } from 'react';
import { ServiceError } from '@rexezuge/errors';
import { installStickerSet, resolveChat } from './api';
import { findLinkedChat, handOffTarget, launchTelegramApp, linkTarget, parseTelegramLink } from './links';
import type { TelegramChatTarget } from './links';
import type { ChatPreview, PendingInvite, ResolveRequest } from './navigation-types';
import type { ChatDto, DialogDto, MessageForwardDto } from './types';
import { useForwardOrigin } from './useForwardOrigin';
import { useInviteNavigation } from './useInviteNavigation';

/**
 * The router for the Telegram navigation points inside message bodies: a chat
 * link, a forward's origin, and a private invite card.
 *
 * A chat the loaded list carries opens at once; anything else is resolved by the
 * bridge, which may open a transient preview, offer the invite card, or hand the
 * target to the installed app. Split from `useSignedInNavigation` so the routing
 * hook stays under the god-file cap; the resolution ticket is shared with it, so
 * a slow answer cannot take the reader away from a screen they moved to after
 * the click.
 */

interface UseLinkRoutingOptions {
  /**
   * Every loaded dialog: a known chat opens without a bridge round trip.
   */
  dialogs: readonly DialogDto[];
  /**
   * The navigation's resolution counter. A link click bumps it, and a slower
   * answer that is no longer the newest is dropped.
   */
  resolutionRef: MutableRefObject<number>;
  openChat: (chat: ChatDto, target?: { postId?: number; commentId?: number }) => void;
  /**
   * Keeps a chat outside the loaded list addressable for this session.
   */
  registerChat: (chat: ChatDto) => void;
  /**
   * Publishes the preview mark, or clears it, for a resolved public chat the
   * account has not joined.
   */
  setPreview: (preview: ChatPreview | null) => void;
  /**
   * Reads the chat list again after a join.
   */
  reload: () => Promise<void>;
  onError: (failure: unknown) => void;
  onNotice: (text: string) => void;
}

interface LinkRouting {
  openForwardOrigin: (forward: MessageForwardDto) => void;
  handleTelegramLink: (url: string) => boolean;
  /**
   * Opens a chat the new-message picker found. A chat already in the list is
   * that chat; anyone else is opened the way a Telegram link resolves one,
   * including the preview the account has not joined yet.
   */
  openFoundChat: (chat: ChatDto) => void;
  invite: PendingInvite | null;
  joinInvite: () => void;
  dismissInvite: () => void;
}

export function useLinkRouting({
  dialogs,
  resolutionRef,
  openChat,
  registerChat,
  setPreview,
  reload,
  onError,
  onNotice,
}: UseLinkRoutingOptions): LinkRouting {
  /**
   * Turns a resolved chat into a thread: a member opens normally, a public chat
   * the account is not in opens as a preview. A target with no public username
   * could not be joined from here, so it goes to the installed app.
   */
  const showResolved = useCallback(
    (chat: ChatDto, member: boolean, target: TelegramChatTarget, request: ResolveRequest): void => {
      if (!member && chat.username === null) {
        handOffTarget(target, request.link);
        return;
      }
      registerChat(chat);
      openChat(chat, {
        ...(request.postId !== undefined && { postId: request.postId }),
        ...(request.commentId !== undefined && { commentId: request.commentId }),
      });
      setPreview(
        member
          ? null
          : {
              chatId: chat.id,
              target,
              joining: false,
              requested: false,
            },
      );
    },
    [openChat, registerChat, setPreview],
  );

  /**
   * Resolves a username or marked id the loaded list does not carry. A 404 is
   * the unknown-chat case and hands the target to the installed app; every
   * other failure is reported.
   */
  const resolveTarget = useCallback(
    (target: TelegramChatTarget, request: ResolveRequest = {}): void => {
      const ticket = ++resolutionRef.current;
      void resolveChat(target)
        .then((result) => {
          if (ticket !== resolutionRef.current) return;
          showResolved(result.chat, result.member, target, request);
        })
        .catch((failure: unknown) => {
          if (ticket !== resolutionRef.current) return;
          if (failure instanceof ServiceError && failure.status === 404) {
            handOffTarget(target, request.link);
            return;
          }
          onError(failure);
        });
    },
    [onError, resolutionRef, showResolved],
  );

  const {
    invite,
    open: openInvite,
    join: joinInvite,
    dismiss: dismissInvite,
  } = useInviteNavigation({ resolutionRef, registerChat, openChat, reload, onError, onNotice });

  const openForwardOrigin = useForwardOrigin(dialogs, openChat, resolveTarget);

  /**
   * Opens a chat the new-message picker found.
   *
   * A person is a member by definition, and the picker's read already stored
   * the peer in the engine's cache, so opening the thread is one route change.
   * A group or a channel may be one the account has not joined: its public
   * username goes through the same resolution a link takes, so the thread
   * shows Join where a composer would fail. A chat whose marked id the list
   * does not carry and whose username Telegram withheld keeps the picker's own
   * DTO, exactly as a transient search hit does.
   */
  const openFoundChat = useCallback(
    (chat: ChatDto): void => {
      const known = dialogs.find((dialog) => dialog.chat.id === chat.id);
      if (known !== undefined) {
        openChat(known.chat);
        return;
      }
      if (chat.kind === 'user' || chat.kind === 'bot' || chat.username === null) {
        registerChat(chat);
        openChat(chat);
        return;
      }
      const username = chat.username;
      const ticket = ++resolutionRef.current;
      void resolveChat({ username })
        .then((result) => {
          if (ticket !== resolutionRef.current) return;
          showResolved(result.chat, result.member, { username }, {});
        })
        .catch(onError);
    },
    [dialogs, onError, openChat, registerChat, resolutionRef, showResolved],
  );

  /**
   * Routes a click on a link inside a message: a chat this client already knows
   * opens in the thread (a linked post lands on that post), any other Telegram
   * chat is resolved and opened or previewed, a private invite opens its card,
   * and everything Telegram cannot open here is handed to the installed app.
   * `false` leaves ordinary web links to the browser.
   */
  const handleTelegramLink = useCallback(
    (url: string): boolean => {
      const link = parseTelegramLink(url);
      if (link === null) return false;
      // A private invite names no peer until Telegram answers: the engine
      // resolves the hash, and the card decides whether the account joins.
      if (link.invite !== null) {
        openInvite(link);
        return true;
      }
      // A sticker pack names no peer: installing it is the whole action, and
      // the toast names what was added.
      if (link.stickerSet !== null) {
        const shortName = link.stickerSet;
        void installStickerSet(shortName)
          .then((set) => onNotice(`Sticker Pack Installed: ${set.title}`))
          .catch(onError);
        return true;
      }
      if (link.chat === null) {
        launchTelegramApp(link.deepLink, link.webUrl);
        return true;
      }
      const target = linkTarget(link.chat);
      const known = findLinkedChat(dialogs, target);
      if (known !== null) {
        openChat(known, {
          ...(link.postId !== null && { postId: link.postId }),
          ...(link.commentId !== null && { commentId: link.commentId }),
        });
        return true;
      }
      resolveTarget(target, {
        ...(link.postId !== null && { postId: link.postId }),
        ...(link.commentId !== null && { commentId: link.commentId }),
        link,
      });
      return true;
    },
    [dialogs, onError, onNotice, openChat, openInvite, resolveTarget],
  );

  return { openForwardOrigin, handleTelegramLink, openFoundChat, invite, joinInvite, dismissInvite };
}
