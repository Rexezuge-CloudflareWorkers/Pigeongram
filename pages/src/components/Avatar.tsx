import { useEffect, useRef, useState } from 'react';
import { avatarUrl } from '../api';
import { initials } from '../format';
import type { PresenceDto } from '../types';

interface AvatarProps {
  chatId: number;
  /**
   * The DTO's avatar version token; null falls back to initials.
   */
  photo: string | null;
  title: string;
  kind?: string;
  small?: boolean;
  /**
   * The large variant: the profile photo of a modal, in the size the engine
   * serves for it. Not combinable with `small`.
   */
  big?: boolean;
  /**
   * The peer's presence, when it has one. Only a person can be online, so the
   * badge appears for an online user and for nobody else.
   */
  presence?: PresenceDto | null;
}

/**
How far outside the viewport an avatar starts loading. The chat list asks for
one avatar per row, and every one of them is a request through the session
engine — which hands out one request at a time — so a row nobody is looking
at must not ask for its photo.
*/
const LOAD_MARGIN = '300px';

/**
Profile photo with the initials fallback. A failed load is remembered per
version token, so a refreshed photo gets a fresh chance.

The image is only requested once the avatar nears the viewport; until then the
initials stand in. An online peer carries a green badge on the avatar's
corner, the way the official clients mark it.
*/
export function Avatar({ chatId, photo, title, kind, small, big, presence }: AvatarProps) {
  const [failedFor, setFailedFor] = useState<string | null>(null);
  // Without an observer there is no viewport to wait for: ask at once.
  const [nearby, setNearby] = useState(() => typeof IntersectionObserver === 'undefined');
  const holder = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const element = holder.current;
    if (!element || nearby) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.every((entry) => !entry.isIntersecting)) return;
        setNearby(true);
        observer.disconnect();
      },
      { rootMargin: LOAD_MARGIN },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [nearby]);

  const showImage = photo !== null && failedFor !== photo && nearby;
  const avatar = (
    <span ref={holder} className={`avatar${small ? ' small' : ''}${big ? ' size-28 text-4xl' : ''}${kind ? ` kind-${kind}` : ''}`}>
      {showImage ? (
        <img src={avatarUrl(chatId, photo, big ? 'big' : 'small')} alt="" loading="lazy" onError={() => setFailedFor(photo)} />
      ) : (
        initials(title)
      )}
    </span>
  );
  if (presence?.status !== 'online') return avatar;
  return (
    <span className="relative inline-flex shrink-0">
      {avatar}
      {/* Presence badge: decorative, so the peer's name carries the meaning
          for assistive tech. The ring matches the panel behind it. */}
      <span
        aria-hidden="true"
        data-status="online"
        className={`absolute -bottom-0.5 -right-0.5 rounded-full border-2 border-panel bg-online group-hover:border-panel-2 ${
          small ? 'size-2.5' : 'size-3'
        }`}
      />
    </span>
  );
}
