import { useEffect, useRef, useState } from 'react';
import { formatListStamp, previewOf } from '../format';
import type { PendingMessage } from '../outbox';
import { withPendingDialogs } from '../outbox';
import type { ChatDto, DialogDto, PeerId } from '../types';
import { Avatar } from './Avatar';
import { Badge } from './Badge';
import { ChatMenu } from './ChatMenu';
import { Icon } from './Icon';

/**
 * How long a touch must hold a chat row before its context menu opens, and how
 * far it may drift first: the slop is what lets a press that turns into a
 * scroll keep scrolling instead of opening the menu.
 */
const LONG_PRESS_MS = 500;
const LONG_PRESS_SLOP_PX = 10;
/**
Horizontal swipe distance that reveals the row's quick actions.
*/
const SWIPE_REVEAL_PX = 56;

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
  const [swipedId, setSwipedId] = useState<PeerId | null>(null);
  const [swipeOffset, setSwipeOffset] = useState(0);
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
    // The official clients shimmer placeholder rows rather than spin: the
    // layout arrives complete and the photos fill in. The live region keeps
    // the wait audible; the bones are decorative.
    return (
      <>
        <span role="status" className="sr-only">
          Loading chats…
        </span>
        <ul className="chat-skeleton" aria-hidden="true">
          {Array.from({ length: 7 }, (_, index) => (
            <li key={index} className="chat-skeleton-row">
              <span className="skeleton skeleton-circle" />
              <span className="skeleton-stack">
                <span className="skeleton skeleton-line short" />
                <span className="skeleton skeleton-line long" />
              </span>
            </li>
          ))}
        </ul>
      </>
    );
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
        {rows.map((dialog, index) => {
          const last = dialog.lastMessage;
          const isSwiped = swipedId === dialog.chat.id;
          return (
            <li key={dialog.chat.id} className="chat-row-enter" style={{ ['--row-index' as string]: index }}>
              <div className="chat-row">
                {isSwiped && dialog.unread > 0 ? (
                  <div className="chat-swipe-actions">
                    <button
                      type="button"
                      className="swipe-btn"
                      onClick={() => {
                        onMarkRead?.(dialog.chat.id);
                        setSwipedId(null);
                        setSwipeOffset(0);
                      }}
                    >
                      <Icon name="check" size={14} /> Read
                    </button>
                  </div>
                ) : null}
                <button
                  type="button"
                  className={`chat group${dialog.chat.id === activeChatId ? ' active' : ''}${isSwiped ? ' is-swiping' : ''}`}
                  style={isSwiped ? { transform: `translateX(${-SWIPE_REVEAL_PX}px)` } : undefined}
                  onClick={() => {
                    if (suppressClick.current) {
                      suppressClick.current = false;
                      return;
                    }
                    if (isSwiped) {
                      setSwipedId(null);
                      setSwipeOffset(0);
                      return;
                    }
                    onSelect(dialog.chat);
                  }}
                  onContextMenu={(event) => {
                    const rect = event.currentTarget.getBoundingClientRect();
                    openMenu(dialog, event.clientX || rect.left + rect.width / 2, event.clientY || rect.top + rect.height / 2);
                    event.preventDefault();
                  }}
                  onPointerDown={(event) => {
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
                        openMenu(
                          {
                            chat: dialog.chat,
                            unread: dialog.unread,
                            pinned: dialog.pinned,
                            archived: dialog.archived,
                            lastMessage: dialog.lastMessage,
                          } as DialogDto,
                          x,
                          y,
                        );
                      }, LONG_PRESS_MS),
                    };
                    setSwipedId((current) => (current === dialog.chat.id ? null : current));
                  }}
                  onPointerMove={(event) => {
                    const current = press.current;
                    if (current === null) return;
                    const dx = event.clientX - current.x;
                    const dy = Math.abs(event.clientY - current.y);
                    // A horizontal swipe left reveals mark-read.
                    if (dx < -LONG_PRESS_SLOP_PX && Math.abs(dx) > dy * 1.2) {
                      cancelPress();
                      setSwipeOffset(Math.max(dx, -SWIPE_REVEAL_PX));
                      if (dx <= -SWIPE_REVEAL_PX) {
                        setSwipedId(dialog.chat.id);
                      }
                      return;
                    }
                    if (
                      Math.abs(event.clientX - current.x) > LONG_PRESS_SLOP_PX ||
                      Math.abs(event.clientY - current.y) > LONG_PRESS_SLOP_PX
                    ) {
                      cancelPress();
                    }
                  }}
                  onPointerUp={() => {
                    cancelPress();
                    if (swipeOffset !== 0 && swipedId !== dialog.chat.id) setSwipeOffset(0);
                  }}
                  onPointerCancel={() => {
                    cancelPress();
                    setSwipeOffset(0);
                  }}
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
                        <Badge count={dialog.unread} />
                      ) : dialog.pinned ? (
                        <span data-pin="pinned" aria-hidden="true" className="shrink-0 text-muted">
                          <Icon name="pin" size={14} />
                        </span>
                      ) : null}
                    </span>
                  </span>
                </button>
              </div>
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
