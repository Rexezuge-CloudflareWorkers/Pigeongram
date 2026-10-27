import { useEffect, useRef, useState } from 'react';
import { formatListStamp, previewOf } from '../format';
import type { PendingMessage } from '../outbox';
import { withPendingDialogs } from '../outbox';
import type { ChatDto, DialogDto, PeerId } from '../types';
import { Avatar } from './Avatar';
import { ChatMenu } from './ChatMenu';
import { Icon } from './Icon';
import { Spinner } from './Spinner';

/**
 * How long a touch must hold a chat row before its context menu opens, and how
 * far it may drift first: the slop is what lets a press that turns into a
 * scroll keep scrolling instead of opening the menu.
 */
const LONG_PRESS_MS = 500;
const LONG_PRESS_SLOP_PX = 10;

interface ChatListProps {
  dialogs: DialogDto[];
  activeChatId: PeerId | null;
  loading: boolean;
  /**
   * Sends still in flight, folded over the server dialogs for the preview and
   * ordering only. Dropping one from the outbox is the rollback.
   */
  pending?: readonly PendingMessage[];
  onSelect: (chat: ChatDto) => void;
  /**
   * Marks a chat read from its context menu, including an unread backlog no
   * thread has loaded.
   */
  onMarkRead?: (chatId: PeerId) => void;
  /**
   * What an empty list says. The archive has its own wording: an empty
   * archive is not an account without chats.
   */
  emptyLabel?: string;
}

interface ChatMenuState {
  chatId: PeerId;
  x: number;
  y: number;
}

export function ChatList({ dialogs, activeChatId, loading, pending = [], onSelect, onMarkRead, emptyLabel }: ChatListProps) {
  /**
   * The open context menu, named by chat rather than by dialog: a live update
   * can replace the row's DTO while the menu is open, and the disabled state
   * should follow the current one.
   */
  const [menu, setMenu] = useState<ChatMenuState | null>(null);
  const press = useRef<{ x: number; y: number; timer: ReturnType<typeof setTimeout> } | null>(null);
  /**
   * A long press that matured already opened the menu; the click the browser
   * dispatches when the finger lifts must not also open the chat.
   */
  const suppressClick = useRef(false);

  // A long press must not outlive the list (a live update can unmount a row).
  useEffect(
    () => () => {
      if (press.current !== null) clearTimeout(press.current.timer);
    },
    [],
  );

  if (loading && dialogs.length === 0) {
    return <Spinner size={32} label="Loading chats…" padding="32px 0" />;
  }
  const rows = pending.length === 0 ? dialogs : withPendingDialogs(dialogs, pending, activeChatId);
  if (rows.length === 0) {
    return <p className="muted pad">{emptyLabel ?? 'No chats yet.'}</p>;
  }
  const menuDialog = menu === null ? null : (rows.find((dialog) => dialog.chat.id === menu.chatId) ?? null);
  const cancelPress = (): void => {
    if (press.current === null) return;
    clearTimeout(press.current.timer);
    press.current = null;
  };
  const openMenu = (dialog: DialogDto, x: number, y: number): void => {
    setMenu({ chatId: dialog.chat.id, x, y });
  };

  return (
    <>
      <ul className="chats">
        {rows.map((dialog) => {
          const last = dialog.lastMessage;
          return (
            <li key={dialog.chat.id}>
              <button
                type="button"
                className={`chat group${dialog.chat.id === activeChatId ? ' active' : ''}`}
                onClick={() => {
                  if (suppressClick.current) {
                    suppressClick.current = false;
                    return;
                  }
                  onSelect(dialog.chat);
                }}
                onContextMenu={(event) => {
                  // Keyboard invocation (the Menu key, Shift+F10) reports no
                  // pointer coordinates; open from the row's center instead.
                  const rect = event.currentTarget.getBoundingClientRect();
                  openMenu(dialog, event.clientX || rect.left + rect.width / 2, event.clientY || rect.top + rect.height / 2);
                  event.preventDefault();
                }}
                onPointerDown={(event) => {
                  // A new gesture is never the lift of the previous long press.
                  suppressClick.current = false;
                  if (event.pointerType !== 'touch') return;
                  cancelPress();
                  const { clientX: x, clientY: y } = event;
                  press.current = {
                    x,
                    y,
                    timer: setTimeout(() => {
                      press.current = null;
                      suppressClick.current = true;
                      openMenu(dialog, x, y);
                    }, LONG_PRESS_MS),
                  };
                }}
                onPointerMove={(event) => {
                  const current = press.current;
                  if (current === null) return;
                  if (
                    Math.abs(event.clientX - current.x) > LONG_PRESS_SLOP_PX ||
                    Math.abs(event.clientY - current.y) > LONG_PRESS_SLOP_PX
                  ) {
                    cancelPress();
                  }
                }}
                onPointerUp={cancelPress}
                onPointerCancel={cancelPress}
              >
                <Avatar
                  chatId={dialog.chat.id}
                  photo={dialog.chat.photo}
                  title={dialog.chat.title}
                  kind={dialog.chat.kind}
                  presence={dialog.chat.presence}
                />
                <span className="chat-body">
                  <span className="chat-top">
                    <span className="chat-title">{dialog.chat.title}</span>
                    {last ? <span className="chat-stamp">{formatListStamp(last.date)}</span> : null}
                  </span>
                  <span className="chat-bottom">
                    <span className="chat-preview">{last ? previewOf(last.text, last.media, last.poll) : '—'}</span>
                    {/* The count and the pin share one slot: the count has priority,
                        so an unread pinned chat drops the pin. */}
                    {dialog.unread > 0 ? (
                      <span className="badge">{dialog.unread > 99 ? '99+' : dialog.unread}</span>
                    ) : dialog.pinned ? (
                      <span data-pin="pinned" aria-hidden="true" className="shrink-0 text-muted">
                        <Icon name="pin" size={14} />
                      </span>
                    ) : null}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {menu && menuDialog ? (
        <ChatMenu dialog={menuDialog} x={menu.x} y={menu.y} onMarkRead={(chatId) => onMarkRead?.(chatId)} onClose={() => setMenu(null)} />
      ) : null}
    </>
  );
}
