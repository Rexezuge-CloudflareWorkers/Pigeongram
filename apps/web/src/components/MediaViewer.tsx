import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { fileUrl } from '../api';
import { formatBytes, mediaPreview } from '../format';
import { downloadFileName } from '../media-download';
import type { MessageDto } from '../types';
import { usePhotoZoom } from '../usePhotoZoom';
import { Icon } from './Icon';
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

Photos zoom: the wheel and a double click (or double tap) zoom around the
pointer, a pinch zooms around its midpoint, and a drag pans once zoomed. Videos
keep their native controls, so zoom is attached to the photo only; the header's
zoom buttons give the same control a keyboard and a discoverable surface.
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
  const stageRef = useRef<HTMLDivElement>(null);
  const current = items[index];
  const media = current?.media ?? null;
  const src = current ? fileUrl(current.chatId, current.id) : '';
  const failed = failedSrc === src;
  const photo = media?.kind === 'photo' && !failed;
  const {
    attachImage,
    style: photoStyle,
    zoomed,
    panning,
    canZoomIn,
    canZoomOut,
    percent,
    zoomIn,
    zoomOut,
    reset: resetZoom,
    consumeDrag,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    onDoubleClick,
    onLoad,
  } = usePhotoZoom({ enabled: photo, mediaId: current?.id ?? null, stageRef });

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
      if (photo && !event.metaKey && !event.ctrlKey && !event.altKey) {
        if (event.key === '+' || event.key === '=') {
          event.preventDefault();
          zoomIn();
          return;
        }
        if (event.key === '-' || event.key === '_') {
          event.preventDefault();
          zoomOut();
          return;
        }
        if (event.key === '0') {
          event.preventDefault();
          resetZoom();
          return;
        }
      }
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
  }, [items.length, onClose, photo, resetZoom, zoomIn, zoomOut]);

  if (!current || !media) return null;

  const title = media.fileName ?? mediaPreview(media.kind);
  const animated = media.kind === 'animation';
  const downloadName = downloadFileName(current);

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
        <div className="media-viewer-tools">
          <a
            className="media-viewer-tool media-viewer-download"
            href={src}
            download={downloadName}
            aria-label="Download original"
            title="Download original"
          >
            <Icon name="download" size={18} />
          </a>
          {photo ? (
            <div className="media-viewer-zoom" role="group" aria-label="Zoom">
              <button type="button" className="media-viewer-tool" aria-label="Zoom out" disabled={!canZoomOut} onClick={zoomOut}>
                <Icon name="minus" size={18} />
              </button>
              <button type="button" className="media-viewer-tool percent" aria-label="Reset zoom" disabled={!zoomed} onClick={resetZoom}>
                {percent}%
              </button>
              <button type="button" className="media-viewer-tool" aria-label="Zoom in" disabled={!canZoomIn} onClick={zoomIn}>
                <Icon name="plus" size={18} />
              </button>
            </div>
          ) : null}
        </div>
        <button ref={closeRef} type="button" className="media-viewer-close" aria-label="Close media viewer" onClick={onClose}>
          <Icon name="close" size={24} />
        </button>
      </header>
      <div
        ref={stageRef}
        className={`media-viewer-stage${photo ? ' is-photo' : ''}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onDoubleClick={onDoubleClick}
        onClick={(event) => {
          const dragged = consumeDrag();
          if (event.target === event.currentTarget && !dragged) onClose();
        }}
      >
        {failed ? (
          <a className="media-viewer-fallback" href={src} download={downloadName} target="_blank" rel="noreferrer">
            <span>{title}</span>
            {media.size === null ? null : <span className="media-viewer-fallback-size">{formatBytes(media.size)}</span>}
          </a>
        ) : media.kind === 'photo' ? (
          <img
            key={current.id}
            ref={attachImage}
            className={`media-viewer-media media-viewer-photo${zoomed ? ' is-zoomed' : ''}${panning ? ' is-panning' : ''}`}
            style={photoStyle}
            src={src}
            alt={title}
            width={media.width ?? undefined}
            height={media.height ?? undefined}
            draggable={false}
            onLoad={onLoad}
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
              <Icon name="arrow-left" size={24} />
            </button>
            <button
              type="button"
              className="media-viewer-nav next"
              aria-label="Next media"
              disabled={index === items.length - 1}
              onClick={() => setIndex(index + 1)}
            >
              <Icon name="arrow-right" size={24} />
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
