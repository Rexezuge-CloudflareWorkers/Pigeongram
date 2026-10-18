import { useState } from 'react';
import { avatarUrl } from '../api';
import { initials } from '../format';

interface AvatarProps {
  chatId: number;
  /**
  The DTO's avatar version token; null falls back to initials.
  */
  photo: string | null;
  title: string;
  kind?: string;
  small?: boolean;
}

/**
Profile photo with the initials fallback. A failed load is remembered per
version token, so a refreshed photo gets a fresh chance.
*/
export function Avatar({ chatId, photo, title, kind, small }: AvatarProps) {
  const [failedFor, setFailedFor] = useState<string | null>(null);
  const showImage = photo !== null && failedFor !== photo;
  return (
    <span className={`avatar${small ? ' small' : ''}${kind ? ` kind-${kind}` : ''}`}>
      {showImage ? <img src={avatarUrl(chatId, photo)} alt="" loading="lazy" onError={() => setFailedFor(photo)} /> : initials(title)}
    </span>
  );
}
