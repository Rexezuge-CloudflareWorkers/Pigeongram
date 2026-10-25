import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { DialogDto, MessageDto, PeerId } from '../types';
import { Avatar } from './Avatar';
import { Icon } from './Icon';

/**
The forward destination picker: a portal modal over the app, with the loaded
dialogs that can accept a message and a search box to narrow them. An album
travels as one display group, so the heading names how many messages move.

The picker owns the request state: a destination is disabled while the forward
is in flight, a failure stays inline (the dialog list is the retry surface),
and Escape, the close button or a click on the backdrop dismiss it. Focus moves
to the search box on open and returns to the opener on unmount, mirroring the
media viewer.
*/

interface ForwardPickerProps {
  /**
  The display group being forwarded, oldest first.
  */
  messages: readonly MessageDto[];
  dialogs: readonly DialogDto[];
  onForward: (dialog: DialogDto) => Promise<void>;
  onClose: () => void;
}

export function ForwardPicker({ messages, dialogs, onForward, onClose }: ForwardPickerProps) {
  const [query, setQuery] = useState('');
  const [busyId, setBusyId] = useState<PeerId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const busy = busyId !== null;
  const destinations = dialogs.filter((dialog) => dialog.chat.canSendMessages && matches(dialog, query));

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
      if (event.key !== 'Escape' || busy) return;
      event.preventDefault();
      onClose();
    };
    addEventListener('keydown', onKeyDown, { capture: true });
    return () => removeEventListener('keydown', onKeyDown, { capture: true });
  }, [busy, onClose]);

  const choose = async (dialog: DialogDto): Promise<void> => {
    if (busy) return;
    setBusyId(dialog.chat.id);
    setError(null);
    try {
      await onForward(dialog);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
      setBusyId(null);
    }
  };

  const label = messages.length === 1 ? 'Forward message' : `Forward ${String(messages.length)} messages`;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.stopPropagation()}
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className="flex max-h-[min(640px,80vh,calc(var(--app-height,100dvh)-2rem))] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-line bg-panel shadow-2xl"
      >
        <header className="flex items-start gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0 flex-1">
            <h2 className="m-0 text-base font-semibold">Forward to…</h2>
            <p className="m-0 text-xs text-muted">{messages.length === 1 ? '1 message' : `${String(messages.length)} messages`}</p>
          </div>
          <button
            type="button"
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-full text-muted hover:bg-panel-2 hover:text-fg disabled:cursor-default disabled:opacity-40"
            aria-label="Close forward picker"
            disabled={busy}
            onClick={onClose}
          >
            <Icon name="close" />
          </button>
        </header>
        <div className="border-b border-line px-4 py-3">
          <input
            ref={searchRef}
            type="search"
            value={query}
            placeholder="Search chats"
            aria-label="Search chats"
            className="w-full"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'ArrowDown') return;
              const first = listRef.current?.querySelector<HTMLButtonElement>('button');
              if (!first) return;
              event.preventDefault();
              first.focus();
            }}
          />
        </div>
        <ul ref={listRef} className="m-0 flex-1 list-none overflow-y-auto p-2" aria-label="Destination chats">
          {destinations.map((dialog) => (
            <li key={dialog.chat.id}>
              <button
                type="button"
                className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-panel-2 disabled:cursor-default disabled:opacity-60"
                disabled={busy}
                onClick={() => void choose(dialog)}
              >
                <Avatar chatId={dialog.chat.id} photo={dialog.chat.photo} title={dialog.chat.title} kind={dialog.chat.kind} small />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate font-semibold">{dialog.chat.title}</span>
                  <span className="truncate text-xs text-muted">
                    {dialog.chat.kind}
                    {dialog.chat.username ? ` · @${dialog.chat.username}` : ''}
                  </span>
                </span>
                {busyId === dialog.chat.id ? <span className="text-xs text-muted">Forwarding…</span> : null}
              </button>
            </li>
          ))}
        </ul>
        {destinations.length === 0 ? (
          <p className="m-0 px-4 pb-3 text-sm text-muted">
            {query.trim().length > 0 ? `No chats match “${query.trim()}”.` : 'No chats you can write to.'}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="m-0 border-t border-line px-4 py-3 text-sm text-danger">
            {error}
          </p>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}

/**
Whether a dialog answers the search: its title or username contains the text,
case-insensitively.
*/
function matches(dialog: DialogDto, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return true;
  return dialog.chat.title.toLowerCase().includes(needle) || (dialog.chat.username?.toLowerCase().includes(needle) ?? false);
}
