import { useEffect, useRef, useState } from 'react';
import { formatCount, formatTime } from '../format';
import { albumCaption, isVisualAlbum } from '../groups';
import { isDownloadable } from '../media-download';
import type { ChatDto, MessageButtonDto, MessageCommentsDto, MessageDto, MessageReactionDto } from '../types';
import { Avatar } from './Avatar';
import { ForwardOrigin } from './ForwardOrigin';
import { Icon } from './Icon';
import { MessageAlbum, MessageMedia } from './Media';
import { MessageButtons } from './MessageButtons';
import { MessageMenu } from './MessageMenu';
import { MessagePoll } from './Poll';
import { MessageReactions } from './MessageReactions';
import { MessageReplyQuote } from './ReplyQuote';
import { MessageText } from './MessageText';
import { MessageUnsupported } from './UnsupportedMedia';
import { useMessageGestures } from './useMessageGestures';
import { MessageWebPage } from './WebPagePreview';

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
touch); a double-click stays as the quick reply path. A horizontal swipe to
the right replies as well.
*/

/**
How long a touch must hold a bubble before the context menu opens, and how far
it may drift first: the slop is what lets a long press that turns into a
scroll keep scrolling instead of opening the menu.
*/
const LONG_PRESS_MS = 500;
const LONG_PRESS_SLOP_PX = 10;

interface MessageRowProps {
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
   Whether this group arrived after the window landed and so animates in;
   history, a cache paint and a re-mount render without motion.
   */
  isNew?: boolean;
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
  /**
  Deletes this display group for everyone; absent where the view does not
  delete. Only the account's own messages are always deletable: another
  member's needs the chat's `deleteMessages` right, and a service message has
  nothing to revoke.
  */
  onDelete?: (messages: readonly MessageDto[]) => void;
  /**
  Whether the account may delete other people's messages here, when it differs
  from the chat's own `canDeleteMessages`. The comments screen passes false: a
  comment lives in the linked discussion group, and the screen carries that
  group's id but not its rights, so only the account's own comments are offered
  for deletion there.
  */
  canDeleteOthers?: boolean;
  /**
  The group's shareable Telegram link, or null when the chat has none (a user
  chat or a basic group). The menu offers Copy Link only with one.
  */
  link?: string | null;
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
  isNew = false,
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
  onDelete,
  canDeleteOthers,
  link = null,
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
  // A service message has nothing to revoke, and someone else's message can
  // only be deleted with the chat's moderation right.
  const canDelete = onDelete !== undefined && !message.service && (own || (canDeleteOthers ?? chat.canDeleteMessages));
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
  // An album downloads per item from the viewer; a single media message can
  // download straight from its menu.
  const downloadable = group.length === 1 && isDownloadable(message);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const press = useRef<{ x: number; y: number; timer: ReturnType<typeof setTimeout> } | null>(null);
  const { swipeOffset, burstKey, dragReply, resetSwipe, burst } = useMessageGestures();

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
  offer. Service messages, and messages with nothing to reply to, forward,
  react to, copy, link or download, open nothing: the global context-menu guard
  has already suppressed the browser's own menu, so a right-click there is
  silent.
  */
  const hasActions =
    onReply !== undefined || onForward !== undefined || onReact !== undefined || message.text.length > 0 || downloadable || link !== null;
  const openMenu = (x: number, y: number): boolean => {
    if (message.service || !hasActions) return false;
    setMenu({ x, y });
    return true;
  };

  // A plain single media/file message renders without the bubble chrome; the
  // time/read check is revealed on hover/focus instead. Anything that adds
  // context (caption, reply, forward, sender, reactions, buttons, web page) or
  // needs the avatar gutter keeps the bubble. Polls and albums stay bubbled.
  const hasCaption = !album && message.text.length > 0;
  // A payload the engine could not read (a media type newer than its MTProto
  // layer, e.g. a Telegram Widget) has no bytes and no caption: the card in
  // its place keeps the message visible instead of leaving a hole.
  const unsupported = message.media?.kind === 'unsupported';
  // A message with nothing at all to draw is the same hole without a media
  // DTO: name it the same way rather than rendering an empty bubble.
  const emptyBody =
    !message.service &&
    !album &&
    message.poll === null &&
    message.media === null &&
    message.webPage === null &&
    message.text.length === 0 &&
    (buttonMessage?.markup ?? null) === null;
  const hasExtras =
    message.forward !== null ||
    (showSender && message.senderName !== null) ||
    (showQuote && message.reply !== null) ||
    avatar !== null ||
    message.reactions.length > 0 ||
    (buttonMessage?.markup ?? null) !== null ||
    message.webPage !== null;
  const bare = !album && message.media !== null && !unsupported && message.poll === null && !message.service && !hasCaption && !hasExtras;

  const meta = (
    <span className="meta">
      {message.views === null ? null : (
        <span className="views" title={`${message.views.toLocaleString()} views`}>
          <Icon name="eye" size={12} /> {formatCount(message.views)}
        </span>
      )}
      {formatTime(message.date)}
      {showStatus ? (
        <span className={`ticks${read ? ' read' : ''}`} role="img" aria-label={read ? 'Read' : 'Sent'} title={read ? 'Read' : 'Sent'}>
          <Icon name={read ? 'done-all' : 'check'} size={14} />
        </span>
      ) : null}
    </span>
  );

  const bubbleStyle = swipeOffset === 0 ? undefined : { transform: `translateX(${String(swipeOffset)}px)` };

  const bubble = (
    <div
      className={`message${own ? ' own' : ''}${message.service ? ' service' : ''}${bare ? ' bare' : ''}`}
      data-message-id={message.id}
      data-new={isNew ? 'true' : 'false'}
      data-message-ids={group.map((entry) => entry.id).join(' ')}
      style={bubbleStyle}
      onDoubleClick={() => {
        if (!message.service && onReply) onReply(message);
      }}
      onContextMenu={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        const opened = openMenu(event.clientX || rect.left + rect.width / 2, event.clientY || rect.top + rect.height / 2);
        if (opened) event.preventDefault();
      }}
      onPointerMove={(event) => {
        const current = press.current;
        if (current === null) return;
        const dx = event.clientX - current.x;
        const dy = Math.abs(event.clientY - current.y);
        if (Math.abs(dx) > LONG_PRESS_SLOP_PX || Math.abs(event.clientY - current.y) > LONG_PRESS_SLOP_PX) {
          cancelPress();
        }
        // A predominantly horizontal drag past the slop is a swipe-to-reply.
        if (dx > LONG_PRESS_SLOP_PX && dx > dy * 1.2 && onReply && !message.service) {
          dragReply(dx, () => onReply(message));
        }
      }}
      onPointerDown={(event) => {
        if (event.pointerType !== 'touch' || (event.target as Element).closest('button, a, audio, video, input, textarea')) return;
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
      onPointerUp={() => {
        cancelPress();
        resetSwipe();
      }}
      onPointerCancel={() => {
        cancelPress();
        resetSwipe();
      }}
    >
      {bare ? (
        <>
          {message.media ? <MessageMedia message={message} media={message.media} onOpen={() => onOpenMedia(message.id)} /> : null}
          {meta}
        </>
      ) : (
        <>
          {message.forward ? <ForwardOrigin forward={message.forward} /> : null}
          {showSender && message.senderName ? <span className="sender">{message.senderName}</span> : null}
          {showQuote && message.reply ? <MessageReplyQuote reply={message.reply} original={original} onJump={onJump} /> : null}
          {album ? (
            <MessageAlbum messages={group} onOpenMedia={(target) => onOpenMedia(target.id)} />
          ) : message.poll ? (
            <MessagePoll message={message} poll={message.poll} onVote={onVote} voting={voting} />
          ) : unsupported || emptyBody ? (
            <MessageUnsupported link={link} />
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
          {message.webPage ? <MessageWebPage message={message} page={message.webPage} /> : null}
          {buttonMessage?.markup ? (
            <MessageButtons message={buttonMessage} markup={buttonMessage.markup} pressing={pressingButton} onPress={onPressButton} />
          ) : null}
          {message.reactions.length > 0 ? (
            <MessageReactions message={message} reacting={reacting} onReact={onReact} burstKey={burstKey} burst={burst} />
          ) : null}
          {meta}
          {onOpenComments && comments && (comments.hasComments || comments.count > 0) ? (
            <button type="button" className="comments-button inline-flex items-center gap-1.5" onClick={() => onOpenComments(message)}>
              <Icon name="comment" size={14} /> {commentLabel(comments)}
            </button>
          ) : null}
        </>
      )}
      {menu ? (
        <MessageMenu
          messages={group}
          x={menu.x}
          y={menu.y}
          onReply={onReply}
          onForward={onForward}
          onReact={onReact}
          onDelete={canDelete ? onDelete : undefined}
          reacting={reacting}
          link={link}
          onClose={() => setMenu(null)}
        />
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
  if (comments.count === 0) return 'Leave A Comment';
  return comments.count === 1 ? '1 Comment' : `${comments.count} Comments`;
}
