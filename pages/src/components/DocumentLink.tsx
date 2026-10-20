import { fileUrl } from '../api';
import { formatBytes } from '../format';
import type { MessageDto } from '../types';

/**
The fallback for media the browser cannot preview: a named file with its size,
downloaded through the same `/user/file` route the players use.
*/
export function DocumentLink({ message }: { message: MessageDto }) {
  const media = message.media;
  return (
    <a
      className="document"
      href={fileUrl(message.chatId, message.id)}
      download={media?.fileName ?? 'download'}
      target="_blank"
      rel="noreferrer"
    >
      <span className="doc-name">{media?.fileName ?? 'File'}</span>
      {media && media.size !== null ? <span className="doc-size">{formatBytes(media.size)}</span> : null}
    </a>
  );
}
