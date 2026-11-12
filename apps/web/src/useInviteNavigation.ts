import { useCallback, useState } from 'react';
import type { MutableRefObject } from 'react';
import { ServiceError } from '@rexezuge/errors';
import { joinInvite as requestJoinInvite, resolveInvite } from './api';
import { launchTelegramApp } from './links';
import type { TelegramLink } from './links';
import type { PendingInvite } from './navigation-types';
import type { ChatDto } from './types';

/**
 * The private invite card: a `t.me/+hash` link whose chat the account is not in
 * yet, and the one write that changes that.
 *
 * Telegram describes such a chat without a peer, so the card is the reader's
 * decision rather than a screen: joining is the account's own, irreversible
 * step, and only Telegram's answer names the chat that then opens. Split from
 * `useSignedInNavigation` so the routing hook stays under the god-file cap; the
 * two share the resolution ticket, so a slow invite answer cannot open a card
 * over a screen the reader moved to afterwards.
 */

interface UseInviteNavigationOptions {
  /**
   * The navigation's resolution counter: a link, a route or a chat click bumps
   * it, and an invite answer that is no longer the newest is dropped.
   */
  resolutionRef: MutableRefObject<number>;
  /**
   * Keeps a chat outside the loaded list addressable for this session.
   */
  registerChat: (chat: ChatDto) => void;
  openChat: (chat: ChatDto) => void;
  /**
   * Reads the chat list again: a joined chat now belongs there.
   */
  reload: () => Promise<void>;
  onError: (failure: unknown) => void;
  onNotice: (text: string) => void;
}

interface InviteNavigation {
  invite: PendingInvite | null;
  open: (link: TelegramLink) => void;
  join: () => void;
  dismiss: () => void;
}

export function useInviteNavigation({
  resolutionRef,
  registerChat,
  openChat,
  reload,
  onError,
  onNotice,
}: UseInviteNavigationOptions): InviteNavigation {
  const [invite, setInvite] = useState<PendingInvite | null>(null);

  /**
   * Resolves the link: a chat the account is already in opens like any other
   * resolved link, and one it is not opens the card. A dead link is reported on
   * its own — expired and malformed are the link's problem, and handing it to
   * the installed app would not help, because it is dead in every client.
   */
  const open = useCallback(
    (link: TelegramLink): void => {
      if (link.invite === null) return;
      const ticket = ++resolutionRef.current;
      void resolveInvite({ invite: link.invite })
        .then((result) => {
          if (ticket !== resolutionRef.current) return;
          if (result.status === 'joined') {
            registerChat(result.chat);
            openChat(result.chat);
            return;
          }
          setInvite({ preview: result.preview, link, joining: false, requested: false });
        })
        .catch((failure: unknown) => {
          if (ticket !== resolutionRef.current) return;
          const notice = inviteFailureNotice(failure);
          if (notice !== null) {
            onNotice(notice);
            return;
          }
          onError(failure);
        });
    },
    [onError, onNotice, openChat, registerChat, resolutionRef],
  );

  /**
   * Joins the chat the card describes. A successful join closes the card and
   * opens the chat Telegram returned; an approval keeps the card up with the
   * request marked, and a guard bot's web view is handed to the installed app
   * through the link the card came from — the only address it has.
   */
  const join = useCallback((): void => {
    if (invite === null || invite.joining || invite.requested || invite.link.invite === null) return;
    setInvite((state) => (state === null ? state : { ...state, joining: true }));
    void requestJoinInvite({ invite: invite.link.invite })
      .then((result) => {
        if (result.status === 'joined' && result.chat !== null) {
          const chat = result.chat;
          registerChat(chat);
          setInvite(null);
          openChat(chat);
          void reload();
          return;
        }
        if (result.status === 'request_sent') {
          setInvite((state) => (state === null ? state : { ...state, requested: true }));
          onNotice('Your Join Request Was Sent. An Admin Has To Approve It.');
          return;
        }
        if (result.status !== 'webview') return;
        setInvite(null);
        onNotice('Telegram Needs This Join Completed In Its Own App.');
        launchTelegramApp(invite.link.deepLink, invite.link.webUrl);
      })
      .catch((failure: unknown) => {
        const notice = inviteFailureNotice(failure);
        if (notice !== null) {
          setInvite(null);
          onNotice(notice);
          return;
        }
        onError(failure);
      })
      .finally(() => {
        setInvite((state) => (state === null ? state : { ...state, joining: false }));
      });
  }, [invite, onError, onNotice, openChat, registerChat, reload]);

  /**
   * Closes the card. A join in flight owns it until it answers, so it cannot be
   * dismissed mid-write.
   */
  const dismiss = useCallback((): void => {
    setInvite((state) => (state === null || state.joining ? state : null));
  }, []);

  return { invite, open, join, dismiss };
}

/**
 * The readable outcome of a dead invite link, or null when the failure is not
 * the link's own.
 *
 * The bridge names the two cases so the card can say which one it hit; an app
 * handoff would not help, because the link is dead in every client.
 */
function inviteFailureNotice(failure: unknown): string | null {
  if (!(failure instanceof ServiceError)) return null;
  if (failure.type === 'invite_expired') return 'This Invite Link Has Expired.';
  if (failure.type === 'invite_invalid') return 'This Invite Link Is Not Valid.';
  return null;
}
