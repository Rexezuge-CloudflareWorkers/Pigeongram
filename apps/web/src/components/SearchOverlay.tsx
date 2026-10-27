import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { formatListStamp, previewOf } from '../format';
import { highlightMatches } from '../search';
import type { SearchScope } from '../search';
import type { ChatDto, MessageDto } from '../types';
import { useSearch } from '../useSearch';
import { Icon } from './Icon';
import { Spinner } from './Spinner';

/**
The message search screen: a portal modal over the app, with a scope toggle
(the open chat or every chat), a debounced query and the pages after it.

A result row names the chat it belongs to (or its sender, inside one chat),
its date and a highlighted preview, so a global hit is readable even when its
chat is not in the loaded list. The overlay owns the request state through
`useSearch`; opening a result is the parent's job, because only it knows how to
open a chat that the list does not carry.

The modal follows the forward picker's rules: Escape, the close button or a
click on the backdrop dismiss it, focus moves to the search box on open and
returns to the opener on unmount.
*/

interface SearchOverlayProps {
  /**
   * The open chat, when there is one. The toggle offers it as a scope; without
   * it the overlay only searches all chats.
   */
  chat: ChatDto | null;
  initialScope: SearchScope;
  initialQuery?: string;
  onOpenResult: (message: MessageDto, chat: ChatDto) => void;
  onClose: () => void;
}

export function SearchOverlay({ chat, initialScope, initialQuery = '', onOpenResult, onClose }: SearchOverlayProps) {
  const { query, setQuery, scope, setScope, messages, chats, loading, loadingMore, error, hasMore, loadMore } = useSearch({
    active: true,
    initialScope,
    initialQuery,
  });
  const inputRef = useRef<HTMLInputElement>(null);
  const needle = query.trim();
  const inChat = scope.kind === 'chat';
  const scopeLabel = inChat ? `in ${chat?.title ?? 'this chat'}` : 'in all chats';

  useEffect(() => {
    const previous = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    inputRef.current?.focus();
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

  // A result names its chat through the page's own chat list, plus the open
  // chat: a chat-only search answers no chats, and a global hit may belong to
  // a chat the sidebar never loaded.
  const chatById = new Map(chats.map((candidate) => [candidate.id, candidate]));
  if (chat !== null) chatById.set(chat.id, chat);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
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
        aria-label="Search messages"
        className="flex max-h-[min(640px,80vh,calc(var(--app-height,100dvh)-2rem))] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-line bg-panel shadow-2xl"
      >
        <header className="flex items-start gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0 flex-1">
            <h2 className="m-0 text-base font-semibold">Search</h2>
            <p className="m-0 text-xs text-muted">Messages {scopeLabel}</p>
          </div>
          <button
            type="button"
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-full text-muted hover:bg-panel-2 hover:text-fg"
            aria-label="Close search"
            onClick={onClose}
          >
            <Icon name="close" />
          </button>
        </header>
        <div className="border-b border-line px-4 py-3">
          <input
            ref={inputRef}
            type="search"
            value={query}
            placeholder="Search messages"
            aria-label="Search messages"
            className="w-full"
            onChange={(event) => setQuery(event.target.value)}
          />
          {chat === null ? null : (
            <div role="group" aria-label="Search scope" className="mt-2 flex gap-1 rounded-lg bg-panel-2 p-1 text-xs font-medium">
              <ScopeButton active={inChat} onClick={() => setScope({ kind: 'chat', chatId: chat.id })}>
                This chat
              </ScopeButton>
              <ScopeButton active={!inChat} onClick={() => setScope({ kind: 'all' })}>
                All chats
              </ScopeButton>
            </div>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {loading && messages.length === 0 ? <Spinner size={28} label="Searching…" padding="24px 0" /> : null}
          {needle.length === 0 ? (
            <p className="m-0 px-2 py-3 text-sm text-muted">Type to search {inChat ? 'this chat' : 'all chats'}.</p>
          ) : null}
          {!loading && needle.length > 0 && messages.length === 0 && error === null ? (
            <p className="m-0 px-2 py-3 text-sm text-muted">No messages found for “{needle}”.</p>
          ) : null}
          {messages.length > 0 ? (
            <ul className="m-0 flex list-none flex-col gap-0.5 p-0" aria-label="Search results">
              {messages.map((message) => {
                const resultChat = chatById.get(message.chatId) ?? null;
                const title = inChat ? (message.senderName ?? resultChat?.title ?? 'Message') : (resultChat?.title ?? 'Message');
                return (
                  <li key={`${String(message.chatId)}:${String(message.id)}`}>
                    <button
                      type="button"
                      className="flex w-full flex-col gap-0.5 rounded-lg px-2 py-2 text-left hover:bg-panel-2 focus-visible:bg-panel-2 focus-visible:outline-none disabled:cursor-default disabled:opacity-60"
                      disabled={resultChat === null}
                      onClick={() => {
                        if (resultChat !== null) onOpenResult(message, resultChat);
                      }}
                    >
                      <span className="flex items-baseline gap-2">
                        <span className="truncate font-semibold">{title}</span>
                        <span className="ml-auto shrink-0 text-xs text-muted">{formatListStamp(message.date)}</span>
                      </span>
                      <span className="line-clamp-2 text-sm text-muted">
                        <HighlightedText text={previewOf(message.text, message.media, message.poll)} query={query} />
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : null}
          {hasMore ? (
            <button
              type="button"
              className="mt-2 w-full rounded-lg px-2 py-2 text-sm font-medium text-accent hover:bg-panel-2 disabled:cursor-default disabled:opacity-60"
              disabled={loadingMore}
              onClick={loadMore}
            >
              {loadingMore ? 'Loading…' : 'Load more results'}
            </button>
          ) : null}
        </div>
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

function ScopeButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={`flex-1 rounded-md px-2 py-1 transition-colors ${active ? 'bg-panel text-fg shadow-sm' : 'text-muted hover:text-fg'}`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/**
The result preview with the query's matches marked. The text is Telegram's own
message text (or the media label), so it is escaped by React as usual.
*/
function HighlightedText({ text, query }: { text: string; query: string }) {
  return (
    <>
      {highlightMatches(text, query).map((segment, index) =>
        segment.match ? (
          <mark key={`${String(index)}:${segment.text}`} className="rounded-sm bg-accent/25 px-0.5 text-inherit">
            {segment.text}
          </mark>
        ) : (
          segment.text
        ),
      )}
    </>
  );
}
