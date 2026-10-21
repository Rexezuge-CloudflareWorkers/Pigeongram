import { useState } from 'react';
import { avatarUrl } from '../api';
import { initials } from '../format';
import type { PresenceDto } from '../types';

interface AvatarProps {
  chatId: number;
  /**
  The DTO's avatar version token; null falls back to initials.
  */
  photo: string | null;
  title: string;
  kind?: string;
  small?: boolean;
  /**
  The peer's presence, when it has one. Only a person can be online, so the
  badge appears for an online user and for nobody else.
  */
  presence?: PresenceDto | null;
}

/**
Profile photo with the initials fallback. A failed load is remembered per
version token, so a refreshed photo gets a fresh chance.

An online peer carries a green badge on the avatar's corner, the way the
official clients mark it.
*/
export function Avatar({ chatId, photo, title, kind, small, presence }: AvatarProps) {
  const [failedFor, setFailedFor] = useState<string | null>(null);
  const showImage = photo !== null && failedFor !== photo;
  const avatar = (
    <span className={`avatar${small ? ' small' : ''}${kind ? ` kind-${kind}` : ''}`}>
      {showImage ? <img src={avatarUrl(chatId, photo)} alt="" loading="lazy" onError={() => setFailedFor(photo)} /> : initials(title)}
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
