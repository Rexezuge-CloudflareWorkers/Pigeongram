import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { formatPresence } from '../format';
import type { ChatDto, ProfileDto } from '../types';
import { Avatar } from './Avatar';
import { Spinner } from './Spinner';

/**
 * The profile of the open chat, in a card in the middle of the screen.
 *
 * The chat the reader opened already carries the peer's name, its handle and
 * its photo, so those are on screen from the first paint; the profile read
 * fills in what the chat list has no room for — a person's bio, a group's
 * description and member count.
 *
 * The card owns the modal behaviours the rest of the SPA expects: focus moves
 * into it, Tab stays inside, Escape and a press on the scrim close it, and the
 * element that opened it gets focus back.
 */

interface ProfilePopupProps {
  chat: ChatDto;
  /**
   * The profile, once it has been read; null while it is on its way.
   */
  profile: ProfileDto | null;
  /**
   * Whether the read is in flight.
   */
  loading: boolean;
  /**
   * Why the profile could not be read, when it could not.
   */
  error: string | null;
  onClose: () => void;
  /**
   * Focuses this callback's target when the popup unmounts. Defaults to the
   * element focused at mount, which is the one that opened the popup.
   */
  returnFocus?: () => void;
}

export function ProfilePopup({ chat, profile, loading, error, onClose, returnFocus }: ProfilePopupProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const returnFocusRef = useRef(returnFocus);

  useEffect(() => {
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    return () => {
      if (returnFocusRef.current === undefined) {
        previousFocusRef.current?.focus();
      } else {
        returnFocusRef.current();
      }
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onClose();
        event.preventDefault();
        return;
      }
      if (event.key !== 'Tab') return;

      const buttons = [...(dialogRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
      if (buttons.length === 0) return;
      const first = buttons[0];
      const last = buttons.at(-1)!;
      const active = document.activeElement;
      const inside = dialogRef.current?.contains(active) ?? false;

      if (event.shiftKey && (!inside || active === first)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (!inside || active === last)) {
        event.preventDefault();
        first.focus();
      }
    };
    // Capture, so Escape lands before the menu that opened this popup (or any
    // other shortcut) sees the key.
    addEventListener('keydown', onKeyDown, { capture: true });
    return () => removeEventListener('keydown', onKeyDown, { capture: true });
  }, [onClose]);

  const title = profile?.title ?? chat.title;
  const username = profile?.username ?? chat.username;
  const photo = profile?.photo ?? chat.photo;
  const presence = formatPresence(chat.presence);
  const members = profile?.membersCount ?? null;

  return createPortal(
    <div
      className="fixed inset-0 z-[70] grid place-items-center bg-black/70 p-4"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="relative w-full max-w-[380px] rounded-3xl border border-line bg-panel-2 p-6 shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <button
          ref={closeRef}
          type="button"
          className="absolute top-3 right-3 inline-flex size-9 items-center justify-center rounded-full text-muted transition-colors hover:bg-panel-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          onClick={onClose}
          aria-label="Close the profile"
        >
          <svg className="size-5 fill-current" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
          </svg>
        </button>

        <div className="flex flex-col items-center gap-3 text-center">
          <Avatar chatId={chat.id} photo={photo} title={title} kind={chat.kind} big />
          <div className="min-w-0">
            <h2 id={titleId} className="truncate text-xl font-semibold">
              {title}
            </h2>
            {username ? <p className="truncate text-[15px] text-muted">@{username}</p> : null}
          </div>
          {presence ? <p className="text-sm text-muted">{presence}</p> : null}
          {loading ? <Spinner inline size={16} label="Loading the profile…" /> : null}
          {error ? <p className="text-sm text-danger">{error}</p> : null}
          {!loading && !error && profile?.about ? <p className="max-w-[46ch] text-[15px] text-muted">{profile.about}</p> : null}
          {!loading && !error && members !== null ? <p className="text-sm text-muted">{members.toLocaleString()} members</p> : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}
