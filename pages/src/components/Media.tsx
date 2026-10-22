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
Whether a media item opens in the full-page viewer: the visual kinds, whose
full size is worth a page of its own. Audio, voice notes and documents keep
their players and links.
*/
export function isViewableMedia(media: MessageMediaDto | null): media is MessageMediaDto {
  return media !== null && (media.kind === 'photo' || media.kind === 'video' || media.kind === 'animation');
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
