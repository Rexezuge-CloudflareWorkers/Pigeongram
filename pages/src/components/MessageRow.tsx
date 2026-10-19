import { useEffect, useRef, useState } from 'react';
import { formatTime } from '../format';
import { albumCaption, isVisualAlbum } from '../groups';
import { renderMessageText } from '../richtext';
import { reactionKey } from '../state';
import type { ChatDto, MessageCommentsDto, MessageDto, MessageReactionDto } from '../types';
import { MessageAlbum, MessageMedia } from './Media';
import { MessageMenu } from './MessageMenu';
import { MessagePoll } from './Poll';
import { MessageReplyQuote } from './ReplyQuote';

/**
One message bubble: reply quote, media, rich text, reaction chips, comments
button and timestamp. Shared by the thread and the comments view; the optional
handlers decide which affordances a given view offers (the comments view's post
header, for example, is inert).

A bubble can also be an album: Telegram delivers grouped media as separate
messages, and the thread renders them together. The first message anchors the
bubble — sender, reply header, reactions and timestamp — matching Telegram,
which stores album reactions on the first message and treats it as the main one.

The bubble's actions live in a context menu (right-click, or a long press on
touch); a double-click stays as the quick reply path.
*/

/**
How long a touch must hold a bubble before the context menu opens, and how far
it may drift first: the slop is what lets a long press that turns into a
scroll keep scrolling instead of opening the menu.
*/
const LONG_PRESS_MS = 500;
const LONG_PRESS_SLOP_PX = 10;

export interface MessageRowProps {
  /**
  One display group, oldest first: a standalone message, or an album's messages.
  */
  group: readonly MessageDto[];
  chat: ChatDto;
  /**
  The loaded message this one replies to, when it is still in the thread.
  */
  original: MessageDto | null;
  /**
  Whether the reply quote renders (default true); the comments view hides it
  for headers that point at the thread's root, which Telegram shows bare.
  */
  showQuote?: boolean;
  /**
  Whether this message has a reaction request in flight; its chips are
  disabled.
  */
  reacting?: boolean;
  onReact?: (message: MessageDto, reaction: MessageReactionDto) => void;
  /**
  Whether this message has a vote in flight; its poll's answers are disabled.
  */
  voting?: boolean;
  /**
  Sends a vote in this message's poll; absent for views that do not vote.
  */
  onVote?: (message: MessageDto, options: number[] | null) => void;
  onReply?: (message: MessageDto) => void;
  onJump?: (messageId: number) => void;
  /**
  Opens the message's comments thread; only rendered when the caller decides
  the chat offers comments.
  */
  onOpenComments?: (message: MessageDto) => void;
}

export function MessageRow({
  group,
  chat,
  original,
  showQuote = true,
  reacting = false,
  onReact,
  voting = false,
  onVote,
  onReply,
  onJump,
  onOpenComments,
}: MessageRowProps) {
  const message = group[0];
  const own = message.outgoing;
  const showSender = !own && chat.kind !== 'user' && !message.service;
  const comments = message.comments;
  const album = group.length > 1;
  const caption = album && isVisualAlbum(group) ? albumCaption(group) : null;
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const press = useRef<{ x: number; y: number; timer: ReturnType<typeof setTimeout> } | null>(null);

  // A long press must not outlive the row (a live update can unmount it).
  useEffect(
    () => () => {
      if (press.current !== null) clearTimeout(press.current.timer);
    },
    [],
  );

  const cancelPress = (): void => {
    if (press.current === null) return;
    clearTimeout(press.current.timer);
    press.current = null;
  };

  /**
  Opens the menu at viewport coordinates when the message has actions to
  offer. Service messages, and messages with nothing to reply to or copy,
  leave the native menu alone, so a right-click falls back to the browser's.
  */
  const openMenu = (x: number, y: number): boolean => {
    if (message.service || (!onReply && message.text.length === 0)) return false;
    setMenu({ x, y });
    return true;
  };

  return (
    <div
      className={`message${own ? ' own' : ''}${message.service ? ' service' : ''}`}
      data-message-id={message.id}
      data-message-ids={group.map((entry) => entry.id).join(' ')}
      onDoubleClick={() => {
        if (!message.service && onReply) onReply(message);
      }}
      onContextMenu={(event) => {
        // Keyboard invocation (the Menu key, Shift+F10) reports no pointer
        // coordinates; open from the bubble's center instead of the corner.
        const rect = event.currentTarget.getBoundingClientRect();
        const opened = openMenu(event.clientX || rect.left + rect.width / 2, event.clientY || rect.top + rect.height / 2);
        if (opened) event.preventDefault();
      }}
      onPointerDown={(event) => {
        if (event.pointerType !== 'touch') return;
        // Descendant controls (reaction chips, links, players) keep their own
        // gestures; a press on them is not a message menu.
        if ((event.target as Element).closest('button, a, audio, video, input, textarea')) return;
        cancelPress();
        const { clientX: x, clientY: y } = event;
        press.current = {
          x,
          y,
          timer: setTimeout(() => {
            press.current = null;
            openMenu(x, y);
          }, LONG_PRESS_MS),
        };
      }}
      onPointerMove={(event) => {
        const current = press.current;
        if (current === null) return;
        if (Math.abs(event.clientX - current.x) > LONG_PRESS_SLOP_PX || Math.abs(event.clientY - current.y) > LONG_PRESS_SLOP_PX) {
          cancelPress();
        }
      }}
      onPointerUp={cancelPress}
      onPointerCancel={cancelPress}
    >
      {showSender && message.senderName ? <span className="sender">{message.senderName}</span> : null}
      {showQuote && message.reply ? <MessageReplyQuote reply={message.reply} original={original} onJump={onJump} /> : null}
      {album ? (
        <MessageAlbum messages={group} />
      ) : message.poll ? (
        <MessagePoll message={message} poll={message.poll} onVote={onVote} voting={voting} />
      ) : message.media ? (
        <MessageMedia message={message} media={message.media} />
      ) : null}
      {caption ? (
        <div className="text">{renderMessageText(caption.text, caption.entities)}</div>
      ) : !album && message.text ? (
        <div className="text">{renderMessageText(message.text, message.entities)}</div>
      ) : null}
      {message.reactions.length > 0 ? (
        <div className="reactions">
          {message.reactions.map((reaction) => {
            const title = reaction.emoji ?? 'Custom emoji';
            const emoji = <span className="reaction-emoji">{reaction.emoji ?? '◻'}</span>;
            const count = <span className="reaction-count">{reaction.count}</span>;
            if (!onReact) {
              return (
                <span key={reactionKey(reaction)} className={`reaction static${reaction.chosen ? ' chosen' : ''}`} title={title}>
                  {emoji}
                  {count}
                </span>
              );
            }
            return (
              <button
                key={reactionKey(reaction)}
                type="button"
                className={`reaction${reaction.chosen ? ' chosen' : ''}`}
                disabled={reacting}
                title={title}
                aria-label={`React ${title} (${String(reaction.count)})`}
                aria-pressed={reaction.chosen}
                onClick={() => onReact(message, reaction)}
              >
                {emoji}
                {count}
              </button>
            );
          })}
        </div>
      ) : null}
      {onOpenComments && comments && (comments.hasComments || comments.count > 0) ? (
        <button type="button" className="comments-button" onClick={() => onOpenComments(message)}>
          💬 {commentLabel(comments)}
        </button>
      ) : null}
      <span className="meta">{formatTime(message.date)}</span>
      {menu ? <MessageMenu message={message} x={menu.x} y={menu.y} onReply={onReply} onClose={() => setMenu(null)} /> : null}
    </div>
  );
}

function commentLabel(comments: MessageCommentsDto): string {
  if (comments.count === 0) return 'Leave a comment';
  return comments.count === 1 ? '1 comment' : `${comments.count} comments`;
}
