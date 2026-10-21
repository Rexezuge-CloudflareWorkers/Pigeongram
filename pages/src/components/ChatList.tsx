import { formatListStamp, previewOf } from '../format';
import type { PendingMessage } from '../outbox';
import { withPendingDialogs } from '../outbox';
import type { ChatDto, DialogDto, PeerId } from '../types';
import { Avatar } from './Avatar';
import { Spinner } from './Spinner';

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
}

export function ChatList({ dialogs, activeChatId, loading, pending = [], onSelect }: ChatListProps) {
  if (loading && dialogs.length === 0) {
    return <Spinner size={32} label="Loading chats…" padding="32px 0" />;
  }
  const rows = pending.length === 0 ? dialogs : withPendingDialogs(dialogs, pending, activeChatId);
  if (rows.length === 0) {
    return <p className="muted pad">No chats yet.</p>;
  }
  return (
    <ul className="chats">
      {rows.map((dialog) => {
        const last = dialog.lastMessage;
        return (
          <li key={dialog.chat.id}>
            <button
              type="button"
              className={`chat group${dialog.chat.id === activeChatId ? ' active' : ''}`}
              onClick={() => onSelect(dialog.chat)}
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
                  <span className="chat-preview">
                    {dialog.pinned ? '📌 ' : ''}
                    {last ? previewOf(last.text, last.media, last.poll) : '—'}
                  </span>
                  {dialog.unread > 0 ? <span className="badge">{dialog.unread > 99 ? '99+' : dialog.unread}</span> : null}
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
