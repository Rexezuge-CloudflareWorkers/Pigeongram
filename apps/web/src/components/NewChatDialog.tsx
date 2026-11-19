import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useNewChat } from '../useNewChat';
import type { ChatDto } from '../types';
import { Avatar } from './Avatar';
import { Icon } from './Icon';
import { Spinner } from './Spinner';
import { TextField } from './TextField';

/**
 * The new-message picker: the account's contacts, and Telegram's own search
 * for a person or a public chat the list does not carry.
 *
 * It is a portal modal like the forward picker, with the same dismissals —
 * Escape, the close button, the scrim — and the same focus discipline. The
 * read belongs to `useNewChat`; this file only paints what the controller
 * found and reports the row the reader chose, which the shell routes through
 * the same resolution a Telegram link takes.
 */

interface NewChatDialogProps {
  onSelect: (chat: ChatDto) => void;
  onClose: () => void;
  /**
   * Whether the dialog is animating out; the parent keeps it mounted for the
   * exit beat.
   */
  exiting?: boolean;
}

export function NewChatDialog({ onSelect, onClose, exiting = false }: NewChatDialogProps) {
  const controller = useNewChat();
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const searching = controller.query.trim().length > 0;

  useEffect(() => {
    const previous = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    searchRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onClose();
    };
    addEventListener('keydown', onKeyDown, { capture: true });
    return () => removeEventListener('keydown', onKeyDown, { capture: true });
  }, [onClose]);

  return createPortal(
    <div
      className={`dialog-scrim fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4${exiting ? ' is-exiting' : ''}`}
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.stopPropagation()}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="New Message"
        className={`dialog-panel flex max-h-[min(640px,80vh,calc(var(--app-height,100dvh)-2rem))] w-full max-w-md flex-col overflow-hidden rounded-xl-increased border border-outline-variant bg-surface-container shadow-2xl${exiting ? ' is-exiting' : ''}`}
      >
        <header className="flex items-start gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0 flex-1">
            <h2 className="m-0 text-base font-semibold">New Message</h2>
            <p className="m-0 text-xs text-muted">
              {searching
                ? 'Results From Telegram, Including People Outside Your Contacts.'
                : 'Your Contacts. Search To Find Anyone On Telegram.'}
            </p>
          </div>
          <button
            type="button"
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-full text-muted hover:bg-panel-2 hover:text-fg"
            aria-label="Close New Message"
            onClick={onClose}
          >
            <Icon name="close" />
          </button>
        </header>
        <div className="border-b border-line px-4 py-3">
          <TextField
            ref={searchRef}
            type="search"
            value={controller.query}
            placeholder="Search People And Chats"
            aria-label="Search people and chats"
            onChange={(event) => controller.setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'ArrowDown') return;
              const first = listRef.current?.querySelector<HTMLButtonElement>('button');
              if (!first) return;
              event.preventDefault();
              first.focus();
            }}
          />
        </div>
        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto p-2">
          {controller.loading ? <Spinner label={searching ? 'Searching…' : 'Loading Contacts…'} /> : null}
          {!controller.loading && controller.error !== null ? (
            <div role="alert" className="flex flex-col items-start gap-3 px-2 py-3">
              <p className="m-0 text-sm text-danger">{controller.error}</p>
              <button
                type="button"
                className="rounded-lg px-3 py-1.5 text-sm font-semibold text-accent hover:bg-panel-2"
                onClick={controller.retry}
              >
                Retry
              </button>
            </div>
          ) : null}
          {!controller.loading && controller.error === null ? (
            <>
              {!searching && controller.contacts.length > 0 ? (
                <ChatGroup id="new-chat-contacts" heading="Contacts" chats={controller.contacts} onSelect={onSelect} />
              ) : null}
              {searching && controller.people.length > 0 ? (
                <ChatGroup id="new-chat-people" heading="People" chats={controller.people} onSelect={onSelect} />
              ) : null}
              {searching && controller.chats.length > 0 ? (
                <ChatGroup id="new-chat-chats" heading="Chats" chats={controller.chats} onSelect={onSelect} />
              ) : null}
              {!searching && controller.contacts.length === 0 ? (
                <p className="m-0 px-3 py-4 text-sm text-muted">No Contacts Yet. Search By Name Or Username.</p>
              ) : null}
              {searching && controller.people.length === 0 && controller.chats.length === 0 ? (
                <p className="m-0 px-3 py-4 text-sm text-muted">Nothing Found For “{controller.query.trim()}”.</p>
              ) : null}
            </>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * One titled block of rows. The heading names the list for assistive tech and
 * is the only visible section label, so both read the same word.
 */
function ChatGroup({
  id,
  heading,
  chats,
  onSelect,
}: {
  id: string;
  heading: string;
  chats: readonly ChatDto[];
  onSelect: (chat: ChatDto) => void;
}) {
  return (
    <div role="group" aria-labelledby={id} className="mb-1">
      <p id={id} className="mx-2 mt-1 mb-1 text-xs font-semibold tracking-wide text-muted uppercase">
        {heading}
      </p>
      <ul className="m-0 list-none p-0">
        {chats.map((chat) => (
          <li key={chat.id}>
            <button
              type="button"
              className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-panel-2 focus-visible:bg-panel-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              onClick={() => onSelect(chat)}
            >
              <Avatar chatId={chat.id} photo={chat.photo} title={chat.title} kind={chat.kind} presence={chat.presence} small />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate font-semibold">{chat.title}</span>
                <span className="truncate text-xs text-muted">
                  {chat.username === null ? chatKindLabel(chat.kind) : `@${chat.username}`}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * What a row says beneath a peer with no public handle: its kind, in the
 * words the rest of the app uses for one.
 */
function chatKindLabel(kind: ChatDto['kind']): string {
  switch (kind) {
    case 'user': {
      return 'Contact';
    }
    case 'bot': {
      return 'Bot';
    }
    case 'group': {
      return 'Group';
    }
    case 'supergroup': {
      return 'Supergroup';
    }
    case 'channel': {
      return 'Channel';
    }
  }
}
