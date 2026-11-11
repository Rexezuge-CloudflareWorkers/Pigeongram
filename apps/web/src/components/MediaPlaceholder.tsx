import type { MessageMediaDto } from '../types';
import { Icon } from './Icon';

/**
 * A media box that has not been downloaded: the data saver's answer for a
 * photo, a video poster, an album cell or an image document. The box keeps the
 * media's aspect ratio so the thread does not reflow when it is swapped for the
 * real thing, and one explicit click asks for the bytes by opening the viewer.
 */
export function MediaPlaceholder({ media, onOpen }: { media: MessageMediaDto; onOpen: () => void }) {
  const animated = media.kind === 'video' || media.kind === 'animation';
  const name = media.fileName ?? (media.kind === 'photo' ? 'photo' : 'media');
  const ratio =
    media.width !== null && media.height !== null && media.height > 0 ? `${String(media.width)} / ${String(media.height)}` : '4 / 3';
  return (
    <button type="button" className="media-placeholder" onClick={onOpen} aria-label={`Load ${name}`} style={{ aspectRatio: ratio }}>
      <Icon name={animated ? 'video' : 'image'} size={28} />
      <span>Tap To Load</span>
    </button>
  );
}
