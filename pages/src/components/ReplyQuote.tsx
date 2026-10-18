import type { ReactNode } from 'react';
import { mediaPreview, previewOf } from '../format';
import { renderMessageText } from '../richtext';
import type { MessageDto, MessageReplyDto } from '../types';

/**
The quote block a reply renders above its message body, and the composer's
"replying to…" banner. Both resolve their snippet the same way: an explicit
quote wins, then the loaded original's rich text, then a media-kind label.
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
  const name = original ? (original.outgoing ? 'You' : original.senderName) : reply.senderName;
  let body: ReactNode;
  if (reply.text) {
    body = renderMessageText(reply.text, reply.entities);
  } else if (original?.text) {
    body = renderMessageText(original.text, original.entities);
  } else if (original?.media) {
    body = mediaPreview(original.media.kind);
  } else if (reply.mediaKind) {
    body = mediaPreview(reply.mediaKind);
  } else {
    body = 'Original message';
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
        <span className="reply-text">{previewOf(message.text, message.media)}</span>
      </div>
      <button type="button" className="reply-cancel" aria-label="Cancel reply" title="Cancel reply" onClick={onCancel}>
        ×
      </button>
    </div>
  );
}
