import { Fragment, useEffect, useRef, useState } from 'react';
import { formatDay, isSameDay } from '../format';
import { groupMessages, messageRowSelector } from '../groups';
import type { CommentsThread } from '../state';
import { settleToBottom } from '../thread-position';
import type { MessageButtonDto, MessageDto, MessageReactionDto } from '../types';
import { Avatar } from './Avatar';
import { Composer } from './Composer';
import { MessageRow } from './MessageRow';
import { Spinner } from './Spinner';

interface CommentsViewProps {
  thread: CommentsThread;
  loading: boolean;
  loadingOlder: boolean;
  sending: boolean;
  uploading: boolean;
  uploadProgress: number | null;
  error: string | null;
  /**
  Comment ids with a reaction request in flight; their chips are disabled.
  */
  reactingIds: ReadonlySet<number>;
  /**
  Comment (or pinned post) ids with a vote in flight; their poll's answers are
  disabled.
  */
  votingIds: ReadonlySet<number>;
  /**
  Comment (or pinned post) ids with a callback button press in flight.
  */
  pressingButtonIds: ReadonlySet<number>;
  onBack: () => void;
  onLoadOlder: () => void;
  onSend: (text: string, replyTo?: number) => Promise<void>;
  onAttach: (file: File, caption: string, replyTo?: number) => Promise<void>;
  onReact: (message: MessageDto, reaction: MessageReactionDto) => void;
  /**
  Starts forwarding a display group; an album forwards every member.
  */
  onForward: (messages: readonly MessageDto[]) => void;
  /**
  Casts a vote in a poll comment, or retracts it with `null`.
  */
  onVote: (message: MessageDto, options: number[] | null) => void;
  /**
  Presses an inline callback or copy button on the post or a comment.
  */
  onPressButton: (message: MessageDto, button: MessageButtonDto) => void;
  /**
  Opens the full-page viewer at a message's media (an album opens at the
  clicked member).
  */
  onOpenMedia: (messageId: number) => void;
}

/**
The comments screen: the post being discussed, its thread from the linked
discussion group (oldest first, newest window on open) and a composer that
posts into the group. Replying to a comment rides the same composer.
*/
export function CommentsView({
  thread,
  loading,
  loadingOlder,
  sending,
  uploading,
  uploadProgress,
  error,
  reactingIds,
  votingIds,
  pressingButtonIds,
  onBack,
  onLoadOlder,
  onSend,
  onAttach,
  onReact,
  onForward,
  onVote,
  onPressButton,
  onOpenMedia,
}: CommentsViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  // Like the thread, the reply target carries its post id so switching to
  // another post's thread invalidates a stale banner without an effect.
  const [replyingTo, setReplyingTo] = useState<{ postId: number; message: MessageDto } | null>(null);

  const comments = thread.comments;
  const lastId = comments.at(-1)?.id ?? 0;
  useEffect(() => {
    const element = scrollRef.current;
    if (!element || !stickToBottom.current) return;
    element.scrollTop = element.scrollHeight;
  }, [lastId, thread.post.id, comments.length]);

  // Media loading after the first paint and the mobile keyboard both change the
  // list's height. A pinned view follows, so the end stays in view.
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    return settleToBottom(element, () => stickToBottom.current);
  }, []);

  const replyTarget = replyingTo !== null && replyingTo.postId === thread.post.id ? replyingTo.message : null;
  const commentById = new Map(comments.map((comment) => [comment.id, comment]));
  const groups = groupMessages(comments);

  const jumpToComment = (messageId: number): void => {
    const target = scrollRef.current?.querySelector(messageRowSelector(messageId));
    if (!(target instanceof HTMLElement)) return;
    target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    target.classList.add('reply-flash');
    setTimeout(() => target.classList.remove('reply-flash'), 1200);
  };

  const send = (text: string, replyTo?: number): Promise<void> => onSend(text, replyTo).then(() => setReplyingTo(null));
  const attach = (file: File, caption: string, replyTo?: number): Promise<void> =>
    onAttach(file, caption, replyTo).then(() => setReplyingTo(null));

  return (
    <section className="thread comments">
      <header className="thread-head">
        <button type="button" className="back" onClick={onBack} aria-label="Back to the channel">
          ←
        </button>
        <Avatar chatId={thread.chat.id} photo={thread.chat.photo} title={thread.chat.title} kind={thread.chat.kind} small />
        <div className="thread-title">
          <strong>Comments</strong>
          <span className="muted small">{thread.chat.title}</span>
        </div>
      </header>
      <div
        className="messages"
        ref={scrollRef}
        onScroll={(event) => {
          const element = event.currentTarget;
          stickToBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
        }}
      >
        <div className="comments-post">
          <MessageRow
            group={[thread.post]}
            chat={thread.chat}
            original={null}
            showQuote={false}
            voting={votingIds.has(thread.post.id)}
            onVote={onVote}
            pressingButton={pressingButtonIds.has(thread.post.id)}
            onPressButton={onPressButton}
            onForward={onForward}
            onOpenMedia={onOpenMedia}
          />
        </div>
        <div className="day">{commentCountLabel(thread.count)}</div>
        {comments.length > 0 && thread.nextOffset ? (
          <button type="button" className="load-older" disabled={loadingOlder} aria-busy={loadingOlder} onClick={onLoadOlder}>
            {loadingOlder ? <Spinner inline size={14} label="Loading…" /> : 'Load older comments'}
          </button>
        ) : null}
        {loading && comments.length === 0 ? <Spinner size={28} label="Loading comments…" padding="24px 0" /> : null}
        {!loading && comments.length === 0 ? (
          <p className="muted pad">{thread.count === 0 ? 'No comments yet — be the first.' : 'No comments loaded.'}</p>
        ) : null}
        {groups.map((group, index) => {
          const anchor = group[0];
          return (
            <Fragment key={anchor.id}>
              {index === 0 || !isSameDay(groups[index - 1][0].date, anchor.date) ? (
                <div className="day">{formatDay(anchor.date)}</div>
              ) : null}
              <MessageRow
                group={group}
                chat={thread.chat}
                original={
                  anchor.reply?.origin === 'same_chat' && anchor.reply.messageId !== null
                    ? (commentById.get(anchor.reply.messageId) ?? null)
                    : null
                }
                showQuote={quoteVisible(anchor, thread, commentById)}
                reacting={reactingIds.has(anchor.id)}
                onReact={onReact}
                voting={votingIds.has(anchor.id)}
                onVote={onVote}
                pressingButton={group.some((message) => pressingButtonIds.has(message.id))}
                onPressButton={onPressButton}
                onReply={(target) => setReplyingTo({ postId: thread.post.id, message: target })}
                onForward={onForward}
                onJump={jumpToComment}
                onOpenMedia={onOpenMedia}
              />
            </Fragment>
          );
        })}
      </div>
      {error ? <p className="error pad">{error}</p> : null}
      <Composer
        placeholder="Comment"
        sending={sending}
        uploading={uploading}
        uploadProgress={uploadProgress}
        replyTarget={replyTarget}
        onCancelReply={() => setReplyingTo(null)}
        onSend={send}
        onAttach={attach}
      />
    </section>
  );
}

/**
Top-level comments carry a reply header pointing at the thread's root, which
Telegram shows without a quote. Replies to comments render their quote only
when it says something: the loaded original, or a named cross-chat sender.
*/
function quoteVisible(comment: MessageDto, thread: CommentsThread, commentsById: Map<number, MessageDto>): boolean {
  const reply = comment.reply;
  if (!reply) return false;
  if (reply.messageId !== null && reply.messageId === thread.discussionMessageId) return false;
  if (reply.origin === 'same_chat') return reply.messageId !== null && commentsById.has(reply.messageId);
  return true;
}

function commentCountLabel(count: number): string {
  return count === 1 ? '1 comment' : `${count} comments`;
}
