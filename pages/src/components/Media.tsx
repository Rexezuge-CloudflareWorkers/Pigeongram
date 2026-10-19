import { fileUrl } from '../api';
import { formatBytes, mediaPreview } from '../format';
import { isVisualAlbum } from '../groups';
import type { MessageDto, MessageMediaDto } from '../types';
import { MessageText } from './MessageText';

/**
One message's media, and the grid or stack an album shares. Split from
`MessageRow` so the bubble chrome and the media layout each stay small.
*/

export function MessageMedia({ message, media }: { message: MessageDto; media: MessageMediaDto }) {
  const src = fileUrl(message.chatId, message.id);
  switch (media.kind) {
    case 'photo': {
      return <img className="photo" src={src} alt={media.fileName ?? 'Photo'} loading="lazy" />;
    }
    case 'video':
    case 'animation': {
      const animation = media.kind === 'animation';
      return (
        <video
          className="video"
          src={src}
          poster={fileUrl(message.chatId, message.id, { thumb: true })}
          controls={!animation}
          autoPlay={animation}
          loop={animation}
          muted={animation}
          playsInline
          preload="metadata"
        />
      );
    }
    case 'audio':
    case 'voice': {
      return <audio className="audio" src={src} controls preload="metadata" />;
    }
    case 'sticker': {
      if (media.mime === 'image/webp') {
        return <img className="sticker" src={src} alt="Sticker" loading="lazy" />;
      }
      return <DocumentLink message={message} />;
    }
    default: {
      return <DocumentLink message={message} />;
    }
  }
}

/**
One album's content. Photos, videos and animations share a square grid (the
thumbnail is enough until a cell is opened); file albums keep a stacked
layout, where Telegram allows a caption under each file.
*/
export function MessageAlbum({ messages }: { messages: readonly MessageDto[] }) {
  if (!isVisualAlbum(messages)) {
    return (
      <div className="album stack">
        {messages.map((message) => (
          <div key={message.id} className="album-row">
            {message.media ? <MessageMedia message={message} media={message.media} /> : null}
            {message.text ? (
              <div className="text">
                <MessageText text={message.text} entities={message.entities} />
              </div>
            ) : null}
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className={`album${messages.length > 4 ? ' many' : ''}`}>
      {messages.map((message) => (
        <AlbumCell key={message.id} message={message} />
      ))}
    </div>
  );
}

/**
A grid cell: the thumbnail links to the full file, which keeps a ten-photo
album from downloading every original up front.
*/
function AlbumCell({ message }: { message: MessageDto }) {
  const media = message.media;
  if (!media) return null;
  const animated = media.kind === 'video' || media.kind === 'animation';
  return (
    <a
      className="cell"
      href={fileUrl(message.chatId, message.id)}
      target="_blank"
      rel="noreferrer"
      aria-label={media.fileName ?? mediaPreview(media.kind)}
    >
      <img src={fileUrl(message.chatId, message.id, { thumb: true })} alt="" loading="lazy" />
      {animated ? (
        <span className="play" aria-hidden="true">
          ▶
        </span>
      ) : null}
    </a>
  );
}

function DocumentLink({ message }: { message: MessageDto }) {
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
