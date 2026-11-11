import type { MessageMediaDto } from '../types';
import { Icon } from './Icon';
import { mediaBoxStyle } from './MediaThumb';

/**
 * A media box that has not been downloaded: the data saver's answer for a
 * photo, a video poster, an album cell or an image document. The box uses the
 * same geometry as the loaded thumbnail, so the thread does not reflow when it
 * is swapped for the real thing, and one explicit click loads that preview in
 * place. Opening the full viewer is then a second click, on the loaded preview.
 */
export function MediaPlaceholder({ media, onLoad }: { media: MessageMediaDto; onLoad: () => void }) {
  const animated = media.kind === 'video' || media.kind === 'animation';
  const name = media.fileName ?? (media.kind === 'photo' ? 'photo' : 'media');
  const ratio = animated ? '16 / 9' : '4 / 3';
  return (
    <button
      type="button"
      className="media-placeholder"
      onClick={onLoad}
      aria-label={`Load ${name}`}
      style={mediaBoxStyle(media.width, media.height, ratio)}
    >
      <Icon name={animated ? 'video' : 'image'} size={28} />
      <span>Tap To Load</span>
    </button>
  );
}
