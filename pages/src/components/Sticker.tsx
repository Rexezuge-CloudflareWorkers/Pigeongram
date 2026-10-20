import { useEffect, useRef, useState } from 'react';
import type { AnimationItem } from 'lottie-web';
import { fileUrl } from '../api';
import type { MessageDto, MessageMediaDto } from '../types';
import { DocumentLink } from './DocumentLink';

interface StickerProps {
  message: MessageDto;
  media: MessageMediaDto;
}

/**
A sticker's inline preview.

Telegram sends three sticker containers: static WebP, video WebM and animated
TGS. The first two are browser-native; TGS is gzipped Lottie JSON, so it is
fetched, decompressed and handed to the Lottie player, which is imported on
demand — a thread without an animated sticker never downloads the player.

A sticker that cannot be decoded falls back to its static thumbnail, and to the
document link when even that is missing: a still preview still beats a download
prompt.
*/
export function StickerMedia({ message, media }: StickerProps) {
  switch (media.mime) {
    case 'image/webp': {
      return (
        <img
          className="sticker"
          src={fileUrl(message.chatId, message.id)}
          alt="Sticker"
          width={media.width ?? undefined}
          height={media.height ?? undefined}
          loading="lazy"
        />
      );
    }
    case 'video/webm': {
      return <VideoSticker message={message} media={media} />;
    }
    case 'application/x-tgsticker': {
      return <AnimatedSticker message={message} media={media} />;
    }
    default: {
      return <DocumentLink message={message} />;
    }
  }
}

/**
Video stickers are short VP9 WebM loops with alpha. They are muted and inline
so autoplay is allowed, and the intrinsic dimensions reserve the bubble before
the first frame arrives.
*/
function VideoSticker({ message, media }: StickerProps) {
  const [failed, setFailed] = useState(false);
  if (failed) return <StickerThumb message={message} media={media} />;
  return (
    <video
      className="sticker"
      src={fileUrl(message.chatId, message.id)}
      width={media.width ?? undefined}
      height={media.height ?? undefined}
      autoPlay
      loop
      muted
      playsInline
      preload="metadata"
      onError={() => setFailed(true)}
    />
  );
}

/**
The TGS player: decompress, then let Lottie draw. The effect owns the fetch and
the animation so unmounting (or StrictMode's second mount) cancels both.
*/
function AnimatedSticker({ message, media }: StickerProps) {
  const src = fileUrl(message.chatId, message.id);
  const container = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const target = container.current;
    if (!target || typeof DecompressionStream === 'undefined') {
      setFailed(true);
      return;
    }

    const abort = new AbortController();
    let animation: AnimationItem | null = null;
    let disposed = false;

    void (async () => {
      try {
        const response = await fetch(src, { signal: abort.signal });
        if (!response.ok || !response.body) {
          throw new Error(`Animated sticker request failed: ${String(response.status)}`);
        }
        const json: unknown = await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).json();
        const { default: lottie } = await import('lottie-web/build/player/lottie_light');
        if (disposed) return;

        const animate = typeof matchMedia !== 'function' || !matchMedia('(prefers-reduced-motion: reduce)').matches;
        animation = lottie.loadAnimation({
          container: target,
          renderer: 'svg',
          loop: true,
          autoplay: animate,
          animationData: json,
        });
        if (!animate) animation.goToAndStop(0, true);
      } catch {
        if (!disposed) setFailed(true);
      }
    })();

    return () => {
      disposed = true;
      abort.abort();
      animation?.destroy();
    };
  }, [src]);

  if (failed) return <StickerThumb message={message} media={media} />;
  const aspectRatio = `${String(media.width ?? 1)} / ${String(media.height ?? 1)}`;
  return <div ref={container} className="sticker-lottie" role="img" aria-label="Sticker" style={{ aspectRatio }} />;
}

/**
The static first frame Telegram keeps beside every sticker document, linked to
the original file. It keeps an unplayable sticker previewable instead of
turning the bubble into a download row.
*/
function StickerThumb({ message, media }: StickerProps) {
  const [failed, setFailed] = useState(false);
  if (failed) return <DocumentLink message={message} />;
  return (
    <a
      className="sticker-link"
      href={fileUrl(message.chatId, message.id)}
      target="_blank"
      rel="noreferrer"
      aria-label={`Open ${media.fileName ?? 'sticker'}`}
    >
      <img
        className="sticker"
        src={fileUrl(message.chatId, message.id, { thumb: true })}
        alt="Sticker"
        width={media.width ?? undefined}
        height={media.height ?? undefined}
        loading="lazy"
        onError={() => setFailed(true)}
      />
    </a>
  );
}
