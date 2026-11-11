import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';

type ThumbState = 'loading' | 'loaded' | 'error';

interface MediaThumbProps {
  src: string;
  alt: string;
  width: number | null;
  height: number | null;
  /**
   * `ratio` shrinks to the DTO's box; `fill` fills a parent that already owns
   * the geometry (an album cell).
   */
  fit?: 'ratio' | 'fill';
  /**
   * The ratio a preview falls back to when Telegram reported no dimensions.
   */
  fallbackRatio?: string;
  className?: string;
  onError?: () => void;
}

/**
 * The width a media preview reserves when Telegram reported no dimensions.
 */
const FALLBACK_WIDTH = 280;

/**
 * The box a media preview reserves before its thumbnail arrives. A known
 * width/height pair gives the exact aspect ratio, so swapping the skeleton for
 * the image does not move the thread; anything missing falls back to a sane
 * preview size.
 */
export function mediaBoxStyle(width: number | null, height: number | null, fallbackRatio = '4 / 3'): CSSProperties {
  const known = width !== null && height !== null && width > 0 && height > 0;
  return {
    width: `min(${String(known ? width : FALLBACK_WIDTH)}px, 100%)`,
    aspectRatio: known ? `${String(width)} / ${String(height)}` : fallbackRatio,
  };
}

/**
 * A media bubble's thumbnail, with the box reserved and the shared skeleton
 * sheen drawn until the bytes land. The image fades in on load instead of
 * popping out of an empty square, and a failed source reports through
 * `onError` so the caller can fall back (thumbnail → original → download).
 *
 * A cached image may finish before React attaches `onLoad`; the effect checks
 * `complete` after commit so a cached thumbnail never stays behind the
 * skeleton.
 */
export function MediaThumb({ src, alt, width, height, fit = 'ratio', fallbackRatio = '4 / 3', className, onError }: MediaThumbProps) {
  const [status, setStatus] = useState<ThumbState>('loading');
  const [renderedSrc, setRenderedSrc] = useState(src);
  const imageRef = useRef<HTMLImageElement>(null);
  // A source swap (the photo's original fallback) starts a new load, so the
  // skeleton comes back until the new bytes arrive.
  if (renderedSrc !== src) {
    setRenderedSrc(src);
    setStatus('loading');
  }

  useEffect(() => {
    const image = imageRef.current;
    if (image?.complete) setStatus(image.naturalWidth > 0 ? 'loaded' : 'error');
  }, [src]);

  const fallback = fit === 'ratio' && (width === null || height === null || width <= 0 || height <= 0);
  const classes = ['media-thumb', `is-${status}`];
  if (fit === 'fill') classes.push('is-fill');
  if (fallback) classes.push('is-fallback');

  return (
    <span className={classes.join(' ')} style={fallback ? mediaBoxStyle(width, height, fallbackRatio) : undefined}>
      <img
        ref={imageRef}
        className={className}
        src={src}
        alt={alt}
        width={width ?? undefined}
        height={height ?? undefined}
        loading="lazy"
        onLoad={() => {
          setStatus('loaded');
        }}
        onError={() => {
          setStatus('error');
          onError?.();
        }}
      />
      {status === 'loading' ? <span className="media-thumb-skeleton skeleton" aria-hidden="true" /> : null}
    </span>
  );
}
