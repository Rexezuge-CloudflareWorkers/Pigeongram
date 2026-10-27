import type { ReactNode } from 'react';
import { mediaPreview, pollPreview, previewOf } from '../format';
import type { MessageDto, MessageReplyDto } from '../types';
import { MessageText } from './MessageText';

/**
The quote block a reply renders above its message body, and the composer's
"replying to…" banner.

The snippet resolves in this order: an explicit quoted fragment, the loaded
original, the original the engine read for an out-of-window reply, a media-kind
label, and finally the unavailable body. A loaded original always wins over a
snapshot, so an edit is never hidden behind a stale preview.
*/

export function MessageReplyQuote({
  reply,
  original,
  onJump,
}: {
  reply: MessageReplyDto;
  /**
  The loaded message this one replies to, when it is still in the thread.
  */
  original: MessageDto | null;
  /**
  Scrolls to the replied-to message; without it the quote renders inert.
  */
  onJump?: (messageId: number) => void;
}) {
  const name = original ? (original.outgoing ? 'You' : original.senderName) : reply.outgoing ? 'You' : reply.senderName;
  let body: ReactNode;
  if (reply.quote && reply.text) {
    body = <MessageText text={reply.text} entities={reply.entities} />;
  } else if (original?.text) {
    body = <MessageText text={original.text} entities={original.entities} />;
  } else if (original?.poll) {
    body = pollPreview(original.poll);
  } else if (original?.media) {
    body = mediaPreview(original.media.kind);
  } else if (reply.text) {
    body = <MessageText text={reply.text} entities={reply.entities} />;
  } else if (reply.mediaKind) {
    body = mediaPreview(reply.mediaKind);
  } else {
    body = 'Quoted Content Unavailable';
  }

  const jumpTarget = original && reply.origin === 'same_chat' ? reply.messageId : null;
  const content = (
    <>
      {name ? <span className="reply-name">{name}</span> : null}
      <span className="reply-text">{body}</span>
    </>
  );

  if (jumpTarget === null || !onJump) {
    return <div className="reply-quote">{content}</div>;
  }
  return (
    <button type="button" className="reply-quote jumpable" title="Go to the replied message" onClick={() => onJump(jumpTarget)}>
      {content}
    </button>
  );
}

export function ComposerReply({ message, onCancel }: { message: MessageDto; onCancel: () => void }) {
  const name = message.outgoing ? 'You' : (message.senderName ?? 'message');
  return (
    <div className="composer-reply">
      <div className="composer-reply-body">
        <span className="reply-name">Reply to {name}</span>
        <span className="reply-text">{previewOf(message.text, message.media, message.poll)}</span>
      </div>
      <button type="button" className="reply-cancel" aria-label="Cancel reply" title="Cancel reply" onClick={onCancel}>
        ×
      </button>
    </div>
  );
}
