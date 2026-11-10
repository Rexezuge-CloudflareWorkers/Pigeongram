import { useState } from 'react';
import { fileUrl } from '../api';
import { mediaPreview } from '../format';
import { isVisualAlbum } from '../groups';
import type { MessageDto, MessageMediaDto } from '../types';
import { DocumentLink } from './DocumentLink';
import { Icon } from './Icon';
import { MessageText } from './MessageText';
import { StickerMedia } from './Sticker';

/**
Whether a document is safe to render as an inline image. Telegram sends some
photos as documents when the sender chooses "send as file", so the MIME type is
the only reliable signal. SVG is excluded like the upload preview and the media
route exclude it: it is active content, not a picture.
*/
function isImageDocument(media: MessageMediaDto | null): boolean {
  if (media === null || media.kind !== 'document' || media.mime === null) return false;
  const mime = media.mime.toLowerCase();
  return mime.startsWith('image/') && mime !== 'image/svg+xml';
}

/**
Whether a media item behaves like a photo: a real photo, or an image sent as a
document. The viewer uses one zoom, swipe and rendering path for both.
*/
export function isPhotoLike(media: MessageMediaDto | null): boolean {
  return media !== null && (media.kind === 'photo' || isImageDocument(media));
}

/**
Whether a media item opens in the full-page viewer: the visual kinds, whose
full size is worth a page of its own, plus image documents. Audio, voice notes
and other documents keep their players and links.
*/
export function isViewableMedia(media: MessageMediaDto | null): media is MessageMediaDto {
  return isPhotoLike(media) || media?.kind === 'video' || media?.kind === 'animation';
}

/**
One message's media, and the grid or stack an album shares. Split from
`MessageRow` so the bubble chrome and the media layout each stay small.

Media that loads lazily carries its `width`/`height` as attributes: the
intrinsic box is reserved before the bytes arrive, so a load does not reflow
the thread (and shift a reader's position) as the images settle in.

A video bubble is a poster tile and opens the full-page viewer; an animation
or audio element that fails — a container or codec the browser cannot decode,
which Telegram does not transcode for — falls back to the document link, so the
file stays reachable instead of leaving a dead player.
*/
export function MessageMedia({ message, media, onOpen }: { message: MessageDto; media: MessageMediaDto; onOpen: () => void }) {
  const src = fileUrl(message.chatId, message.id);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  if (failedSrc === src) return <DocumentLink message={message} />;
  const onError = (): void => {
    setFailedSrc(src);
  };
  switch (media.kind) {
    case 'photo': {
      return (
        <button type="button" className="media-open" onClick={onOpen} aria-label={`Open ${media.fileName ?? 'photo'}`}>
          <img
            className="photo"
            src={src}
            alt={media.fileName ?? 'Photo'}
            width={media.width ?? undefined}
            height={media.height ?? undefined}
            loading="lazy"
          />
        </button>
      );
    }
    case 'video': {
      return (
        <button type="button" className="video-tile" onClick={onOpen} aria-label={`Play ${media.fileName ?? 'video'}`}>
          <img
            src={fileUrl(message.chatId, message.id, { thumb: true })}
            alt=""
            width={media.width ?? undefined}
            height={media.height ?? undefined}
            loading="lazy"
          />
          <span className="play" aria-hidden="true">
            <Icon name="play" size={22} />
          </span>
          {media.duration === null ? null : <span className="duration">{durationLabel(media.duration)}</span>}
        </button>
      );
    }
    case 'animation': {
      return (
        <button type="button" className="media-open" onClick={onOpen} aria-label={`Open ${media.fileName ?? 'GIF'}`}>
          <video
            className="video"
            src={src}
            poster={fileUrl(message.chatId, message.id, { thumb: true })}
            width={media.width ?? undefined}
            height={media.height ?? undefined}
            autoPlay
            loop
            muted
            playsInline
            preload="metadata"
            onError={onError}
          />
        </button>
      );
    }
    case 'audio':
    case 'voice': {
      return <audio className="audio" src={src} controls preload="metadata" onError={onError} />;
    }
    case 'sticker': {
      return <StickerMedia message={message} media={media} />;
    }
    case 'document': {
      return isImageDocument(media) ? (
        <DocumentImage message={message} media={media} onOpen={onOpen} />
      ) : (
        <DocumentLink message={message} />
      );
    }
    default: {
      return <DocumentLink message={message} />;
    }
  }
}

/**
An image sent as a document. Telegram's thumbnail is enough to preview it in
the bubble; the original is used for a GIF (so it animates) and as the fallback
when a document has no thumbnail. An image the browser cannot decode falls back
to the download link rather than leaving an empty box.
*/
function DocumentImage({ message, media, onOpen }: { message: MessageDto; media: MessageMediaDto; onOpen: () => void }) {
  const original = fileUrl(message.chatId, message.id);
  const [src, setSrc] = useState(() =>
    media.mime?.toLowerCase() === 'image/gif' ? original : fileUrl(message.chatId, message.id, { thumb: true }),
  );
  const [failed, setFailed] = useState(false);
  if (failed) return <DocumentLink message={message} />;
  return (
    <button type="button" className="media-open document-image" onClick={onOpen} aria-label={`Open ${media.fileName ?? 'image'}`}>
      <img
        className="photo"
        src={src}
        alt={media.fileName ?? 'Image'}
        width={media.width ?? undefined}
        height={media.height ?? undefined}
        loading="lazy"
        onError={() => {
          if (src !== original) {
            setSrc(original);
            return;
          }
          setFailed(true);
        }}
      />
    </button>
  );
}

/**
One album's content. Photos, videos and animations share a square grid (the
thumbnail is enough until a cell is opened); file albums keep a stacked
layout, where Telegram allows a caption under each file.
*/
export function MessageAlbum({ messages, onOpenMedia }: { messages: readonly MessageDto[]; onOpenMedia: (message: MessageDto) => void }) {
  if (!isVisualAlbum(messages)) {
    return (
      <div className="album stack">
        {messages.map((message) => (
          <div key={message.id} className="album-row">
            {message.media ? <MessageMedia message={message} media={message.media} onOpen={() => onOpenMedia(message)} /> : null}
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
        <AlbumCell key={message.id} message={message} onOpen={() => onOpenMedia(message)} />
      ))}
    </div>
  );
}

/**
A grid cell: the thumbnail is enough until the cell opens the full-page
viewer, which keeps a ten-photo album from downloading every original up
front.
*/
function AlbumCell({ message, onOpen }: { message: MessageDto; onOpen: () => void }) {
  const media = message.media;
  if (!media) return null;
  const animated = media.kind === 'video' || media.kind === 'animation';
  return (
    <button type="button" className="cell" onClick={onOpen} aria-label={`Open ${media.fileName ?? mediaPreview(media.kind)}`}>
      <img src={fileUrl(message.chatId, message.id, { thumb: true })} alt="" loading="lazy" />
      {animated ? (
        <span className="play" aria-hidden="true">
          <Icon name="play" size={22} />
        </span>
      ) : null}
    </button>
  );
}

/**
Video duration on the poster tile, matching the short clock Telegram shows:
`0:12`, `4:05`, `1:02:03`.
*/
function durationLabel(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainder = String(total % 60).padStart(2, '0');
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${remainder}` : `${minutes}:${remainder}`;
}
