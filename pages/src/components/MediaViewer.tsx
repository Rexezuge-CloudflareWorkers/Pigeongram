import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { fileUrl } from '../api';
import { formatBytes, mediaPreview } from '../format';
import type { MessageDto } from '../types';
import { isViewableMedia } from './Media';
import { MessageText } from './MessageText';

/**
The full-page media viewer: one photo or video over the whole viewport, with
its album's other visual items a click or arrow key away. The overlay is a
portal so the thread's scroll container cannot clip it, and it stops pointer
events at its root because React still bubbles portal events through the
message bubble that opened it (a right-click here must not open the bubble's
menu).

The viewer closes on Escape, the close button or a click on the stage around
the media; focus moves to the close button for the keyboard and returns to the
media that opened the viewer when it unmounts.
*/

interface MediaViewerProps {
  /**
  The clicked message's display group: a single message, or an album. Only the
  visual members are navigable.
  */
  messages: readonly MessageDto[];
  initialMessageId: number;
  onClose: () => void;
}

export function MediaViewer({ messages, initialMessageId, onClose }: MediaViewerProps) {
  const items = messages.filter((message) => isViewableMedia(message.media));
  const initialIndex = Math.max(
    0,
    items.findIndex((message) => message.id === initialMessageId),
  );
  const [index, setIndex] = useState(initialIndex);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const current = items[index];

  useEffect(() => {
    const previous = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      // Seeking in a focused player keeps the arrow keys; the gallery owns
      // them everywhere else.
      if (event.target instanceof HTMLMediaElement) return;
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        setIndex((value) => Math.max(0, value - 1));
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        setIndex((value) => Math.min(items.length - 1, value + 1));
      }
    };
    addEventListener('keydown', onKeyDown, { capture: true });
    return () => removeEventListener('keydown', onKeyDown, { capture: true });
  }, [items.length, onClose]);

  if (!current) return null;

  const media = current.media;
  if (!media) return null;

  const src = fileUrl(current.chatId, current.id);
  const title = media.fileName ?? mediaPreview(media.kind);
  const animated = media.kind === 'animation';
  const failed = failedSrc === src;

  return createPortal(
    <div
      className="media-viewer"
      role="dialog"
      aria-modal="true"
      aria-label="Media viewer"
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.stopPropagation()}
    >
      <header className="media-viewer-head">
        <div className="media-viewer-title">
          <span className="media-viewer-name">{title}</span>
          {items.length > 1 ? (
            <span className="media-viewer-count">
              {index + 1} / {items.length}
            </span>
          ) : null}
        </div>
        <button ref={closeRef} type="button" className="media-viewer-close" aria-label="Close media viewer" onClick={onClose}>
          ×
        </button>
      </header>
      <div
        className="media-viewer-stage"
        onClick={(event) => {
          if (event.target === event.currentTarget) onClose();
        }}
      >
        {failed ? (
          <a className="media-viewer-fallback" href={src} download={media.fileName ?? 'download'} target="_blank" rel="noreferrer">
            <span>{title}</span>
            {media.size === null ? null : <span className="media-viewer-fallback-size">{formatBytes(media.size)}</span>}
          </a>
        ) : media.kind === 'photo' ? (
          <img
            key={current.id}
            className="media-viewer-media"
            src={src}
            alt={title}
            width={media.width ?? undefined}
            height={media.height ?? undefined}
            onError={() => setFailedSrc(src)}
          />
        ) : (
          <video
            key={current.id}
            className="media-viewer-media"
            src={src}
            poster={fileUrl(current.chatId, current.id, { thumb: true })}
            width={media.width ?? undefined}
            height={media.height ?? undefined}
            controls={!animated}
            autoPlay
            loop={animated}
            muted={animated}
            playsInline
            preload="metadata"
            onError={() => setFailedSrc(src)}
          />
        )}
        {items.length > 1 ? (
          <>
            <button
              type="button"
              className="media-viewer-nav prev"
              aria-label="Previous media"
              disabled={index === 0}
              onClick={() => setIndex(index - 1)}
            >
              ←
            </button>
            <button
              type="button"
              className="media-viewer-nav next"
              aria-label="Next media"
              disabled={index === items.length - 1}
              onClick={() => setIndex(index + 1)}
            >
              →
            </button>
          </>
        ) : null}
      </div>
      {current.text.length > 0 ? (
        <div className="media-viewer-caption">
          <MessageText text={current.text} entities={current.entities} />
        </div>
      ) : null}
    </div>,
    document.body,
  );
}
