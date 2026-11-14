import { Fragment } from 'react';
import { formatDay, isSameDay } from '../format';
import { messageWebLink } from '../links';
import type { ChatDto, MessageButtonDto, MessageDto, MessageReactionDto } from '../types';
import { MessageRow } from './MessageRow';

/**
The loaded rows of a thread: the day dividers, the unread line, one bubble per
display group (an album is one), and the pending sends below them.

Split from `ThreadView.tsx` so that view stays under the god-file cap; the
scroll machinery, the header and the composer stay there. Nothing here owns
state: every action is handed in, and a preview chat withholds the same
handlers the view does.
*/

interface ThreadMessageRowsProps {
  chat: ChatDto;
  /**
  The loaded messages, grouped for display, oldest first.
  */
  groups: readonly (readonly MessageDto[])[];
  /**
  Every loaded message by id, for resolving same-chat reply quotes.
  */
  messageById: ReadonlyMap<number, MessageDto>;
  newMessageIds: ReadonlySet<number>;
  reactingIds: ReadonlySet<number>;
  votingIds: ReadonlySet<number>;
  pressingButtonIds: ReadonlySet<number>;
  readOutboxMaxId: number;
  /**
  The message the unread divider sits above, or null when there is none.
  */
  unreadDividerId: number | null;
  /**
  Whether the chat is a preview the account has not joined; the writing
  actions are withheld then.
  */
  preview: { joining: boolean; requested: boolean } | null;
  onReact: (message: MessageDto, reaction: MessageReactionDto) => void;
  onVote: (message: MessageDto, options: number[] | null) => void;
  onPressButton: (message: MessageDto, button: MessageButtonDto) => void;
  onReply: (message: MessageDto) => void;
  /**
  Starts editing a message's text; a preview chat withholds it, as it withholds
  every other write.
  */
  onEdit: (message: MessageDto) => void;
  onForward: (messages: readonly MessageDto[]) => void;
  onDelete: (messages: readonly MessageDto[]) => void;
  onJump: (messageId: number) => void;
  onOpenComments: (message: MessageDto) => void;
  onOpenMedia: (messageId: number) => void;
}

export function ThreadMessageRows({
  chat,
  groups,
  messageById,
  newMessageIds,
  reactingIds,
  votingIds,
  pressingButtonIds,
  readOutboxMaxId,
  unreadDividerId,
  preview,
  onReact,
  onVote,
  onPressButton,
  onReply,
  onEdit,
  onForward,
  onDelete,
  onJump,
  onOpenComments,
  onOpenMedia,
}: ThreadMessageRowsProps) {
  return (
    <>
      {groups.map((group, index) => {
        const anchor = group[0];
        return (
          <Fragment key={anchor.id}>
            {index === 0 || !isSameDay(groups[index - 1][0].date, anchor.date) ? <div className="day">{formatDay(anchor.date)}</div> : null}
            {group.some((message) => message.id === unreadDividerId) ? (
              <div className="unread-divider" data-unread-divider>
                Unread Messages
              </div>
            ) : null}
            <MessageRow
              group={group}
              chat={chat}
              showAvatar={chat.kind === 'group' || chat.kind === 'supergroup'}
              original={
                anchor.reply?.origin === 'same_chat' && anchor.reply.messageId !== null
                  ? (messageById.get(anchor.reply.messageId) ?? null)
                  : null
              }
              isNew={group.some((message) => newMessageIds.has(message.id))}
              reacting={reactingIds.has(anchor.id)}
              onReact={preview === null ? onReact : undefined}
              voting={votingIds.has(anchor.id)}
              onVote={preview === null ? onVote : undefined}
              pressingButton={group.some((message) => pressingButtonIds.has(message.id))}
              onPressButton={preview === null ? onPressButton : undefined}
              readOutboxMaxId={readOutboxMaxId}
              onReply={preview === null ? onReply : undefined}
              onEdit={preview === null ? onEdit : undefined}
              onForward={onForward}
              onDelete={preview === null ? onDelete : undefined}
              link={messageWebLink(chat, anchor.id)}
              onJump={onJump}
              onOpenComments={preview === null && chat.kind === 'channel' ? onOpenComments : undefined}
              onOpenMedia={onOpenMedia}
            />
          </Fragment>
        );
      })}
    </>
  );
}
