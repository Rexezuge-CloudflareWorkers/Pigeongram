import { Fragment, useEffect, useRef, useState } from 'react';
import { formatDay, isSameDay } from '../format';
import { groupMessages, messageRowSelector } from '../groups';
import type { CommentsThread } from '../state';
import type { MessageDto, MessageReactionDto } from '../types';
import { Avatar } from './Avatar';
import { Composer } from './Composer';
import { MessageRow } from './MessageRow';

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
  onBack: () => void;
  onLoadOlder: () => void;
  onSend: (text: string, replyTo?: number) => Promise<void>;
  onAttach: (file: File, caption: string, replyTo?: number) => Promise<void>;
  onReact: (message: MessageDto, reaction: MessageReactionDto) => void;
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
  onBack,
  onLoadOlder,
  onSend,
  onAttach,
  onReact,
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

  // The thread's settling rule: media loads grow the list after the open
  // scroll, and a pinned view follows the growth instead of losing the end.
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const settle = (): void => {
      if (!stickToBottom.current) return;
      element.scrollTop = element.scrollHeight;
    };
    // Media events do not bubble; a capture listener still sees them.
    element.addEventListener('load', settle, { capture: true });
    element.addEventListener('error', settle, { capture: true });
    element.addEventListener('loadedmetadata', settle, { capture: true });
    return () => {
      element.removeEventListener('load', settle, true);
      element.removeEventListener('error', settle, true);
      element.removeEventListener('loadedmetadata', settle, true);
    };
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
          <MessageRow group={[thread.post]} chat={thread.chat} original={null} showQuote={false} />
        </div>
        <div className="day">{commentCountLabel(thread.count)}</div>
        {comments.length > 0 && thread.nextOffset ? (
          <button type="button" className="load-older" disabled={loadingOlder} onClick={onLoadOlder}>
            {loadingOlder ? 'Loading…' : 'Load older comments'}
          </button>
        ) : null}
        {loading && comments.length === 0 ? <p className="muted pad">Loading comments…</p> : null}
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
                onReply={(target) => setReplyingTo({ postId: thread.post.id, message: target })}
                onJump={jumpToComment}
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
