import { useEffect, useRef, useState } from 'react';
import { formatCount, formatTime } from '../format';
import { albumCaption, isVisualAlbum } from '../groups';
import { reactionKey } from '../state';
import type { ChatDto, MessageButtonDto, MessageCommentsDto, MessageDto, MessageReactionDto } from '../types';
import { Avatar } from './Avatar';
import { ForwardOrigin } from './ForwardOrigin';
import { MessageAlbum, MessageMedia } from './Media';
import { MessageButtons } from './MessageButtons';
import { MessageMenu } from './MessageMenu';
import { MessagePoll } from './Poll';
import { MessageReplyQuote } from './ReplyQuote';
import { MessageText } from './MessageText';

/**
One message bubble: forward header, sender, reply quote, media, rich text,
reaction chips, the view count and timestamp, and — for a channel post with a
thread — the comments button in its footer. Shared by the thread and the
comments view; the optional handlers decide which affordances a given view
offers (the comments view's post header, for example, is not a reply target).

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
  Whether the sender's avatar renders beside the bubble (default false).
  */
  showAvatar?: boolean;
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
  /**
  Whether a callback button on this message is in flight; its callback
  buttons are disabled.
  */
  pressingButton?: boolean;
  /**
  Id of the last outgoing message the peer has read. Own messages up to it
  render a double check, later ones a single sent check; channels keep their
  views instead. Defaults to 0 for views that do not track the watermark.
  */
  readOutboxMaxId?: number;
  /**
  Presses a callback or copy button; absent for views that do not press.
  */
  onPressButton?: (message: MessageDto, button: MessageButtonDto) => void;
  onReply?: (message: MessageDto) => void;
  /**
  Starts forwarding this display group; an album forwards every member.
  */
  onForward?: (messages: readonly MessageDto[]) => void;
  onJump?: (messageId: number) => void;
  /**
  Opens the message's comments thread; only rendered when the caller decides
  the chat offers comments.
  */
  onOpenComments?: (message: MessageDto) => void;
  /**
  Opens the full-page media viewer at this message's media; an album opens at
  the clicked member. The app owns the viewer so it can take a history layer.
  */
  onOpenMedia: (messageId: number) => void;
}

export function MessageRow({
  group,
  chat,
  original,
  showQuote = true,
  showAvatar = false,
  reacting = false,
  onReact,
  voting = false,
  onVote,
  pressingButton = false,
  onPressButton,
  readOutboxMaxId = 0,
  onReply,
  onForward,
  onJump,
  onOpenComments,
  onOpenMedia,
}: MessageRowProps) {
  const message = group[0];
  const own = message.outgoing;
  // Channels report views instead of read receipts, and service messages have
  // no bubble to put a status on.
  const showStatus = own && !message.service && chat.kind !== 'channel';
  const read = showStatus && message.id <= readOutboxMaxId;
  const showSender = !own && chat.kind !== 'user' && !message.service;
  const comments = message.comments;
  const album = group.length > 1;
  const caption = album && isVisualAlbum(group) ? albumCaption(group) : null;
  // The caller enables avatars for group threads and comments; service messages and anonymous senders have none.
  const avatar =
    showAvatar && !message.service && message.senderId !== null && (message.senderPhoto !== null || message.senderName !== null) ? (
      <Avatar chatId={message.senderId} photo={message.senderPhoto} title={message.senderName ?? ''} small />
    ) : null;
  // Telegram attaches an album's keyboard to one of its members, not
  // necessarily the first; that member is also the callback's target.
  const buttonMessage = group.find((entry) => entry.markup !== null) ?? null;
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
  offer. Service messages, and messages with nothing to reply to, forward or
  copy, leave the native menu alone, so a right-click falls back to the
  browser's.
  */
  const openMenu = (x: number, y: number): boolean => {
    if (message.service || (!onReply && !onForward && message.text.length === 0)) return false;
    setMenu({ x, y });
    return true;
  };

  const bubble = (
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
      {message.forward ? <ForwardOrigin forward={message.forward} /> : null}
      {showSender && message.senderName ? <span className="sender">{message.senderName}</span> : null}
      {showQuote && message.reply ? <MessageReplyQuote reply={message.reply} original={original} onJump={onJump} /> : null}
      {album ? (
        <MessageAlbum messages={group} onOpenMedia={(target) => onOpenMedia(target.id)} />
      ) : message.poll ? (
        <MessagePoll message={message} poll={message.poll} onVote={onVote} voting={voting} />
      ) : message.media ? (
        <MessageMedia message={message} media={message.media} onOpen={() => onOpenMedia(message.id)} />
      ) : null}
      {caption ? (
        <div className="text">
          <MessageText text={caption.text} entities={caption.entities} />
        </div>
      ) : !album && message.text ? (
        <div className="text">
          <MessageText text={message.text} entities={message.entities} />
        </div>
      ) : null}
      {buttonMessage?.markup ? (
        <MessageButtons message={buttonMessage} markup={buttonMessage.markup} pressing={pressingButton} onPress={onPressButton} />
      ) : null}
      {message.reactions.length > 0 ? (
        <div className="reactions">
          {message.reactions.map((reaction) => {
            const title = reaction.emoji ?? 'Custom emoji';
            const emoji = <span className="reaction-emoji">{reaction.emoji ?? '◻'}</span>;
            const count = <span className="reaction-count">{reaction.count}</span>;
            if (!onReact) {
              return (
                <span key={reactionKey(reaction)} className={`reaction is-static${reaction.chosen ? ' chosen' : ''}`} title={title}>
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
      <span className="meta">
        {message.views === null ? null : (
          <span className="views" title={`${message.views.toLocaleString()} views`}>
            👁 {formatCount(message.views)}
          </span>
        )}
        {showStatus ? (
          <span className={`ticks${read ? ' read' : ''}`} role="img" aria-label={read ? 'Read' : 'Sent'} title={read ? 'Read' : 'Sent'}>
            {read ? '✓✓' : '✓'}
          </span>
        ) : null}
        {formatTime(message.date)}
      </span>
      {onOpenComments && comments && (comments.hasComments || comments.count > 0) ? (
        <button type="button" className="comments-button" onClick={() => onOpenComments(message)}>
          💬 {commentLabel(comments)}
        </button>
      ) : null}
      {menu ? (
        <MessageMenu messages={group} x={menu.x} y={menu.y} onReply={onReply} onForward={onForward} onClose={() => setMenu(null)} />
      ) : null}
    </div>
  );
  if (!avatar) return bubble;
  return (
    <div className={`message-line${own ? ' own' : ''}`}>
      {avatar}
      {bubble}
    </div>
  );
}

function commentLabel(comments: MessageCommentsDto): string {
  if (comments.count === 0) return 'Leave a comment';
  return comments.count === 1 ? '1 comment' : `${comments.count} comments`;
}
