import type { MessageMediaDto, MessagePollDto, PresenceDto } from './types';

const timeFormatter = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });

export function formatTime(timestamp: number): string {
  return timeFormatter.format(timestamp);
}

/**
Short stamp for the chat list: `now`, `5m`, `3h`, or `Mar 4`.
*/
export function formatListStamp(timestamp: number, now = Date.now()): string {
  const diff = now - timestamp;
  if (diff < 60_000) return 'now';
  if (diff < 3_600_000) return `${Math.max(1, Math.floor(diff / 60_000))}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(timestamp);
}

export function formatDay(timestamp: number, now = Date.now()): string {
  const date = new Date(timestamp);
  const today = new Date(now);
  if (date.toDateString() === today.toDateString()) return 'Today';
  const yesterday = new Date(now - 86_400_000);
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(date.getFullYear() !== today.getFullYear() && { year: 'numeric' }),
  });
}

export function isSameDay(a: number, b: number): boolean {
  return new Date(a).toDateString() === new Date(b).toDateString();
}

/**
 * What a presence reads as: `online`, `last seen today at 14:32`, or one of
 * the coarse states Telegram reports when it hides the exact time. Null when
 * the peer has no presence at all — a bot, a group, a channel, or a person who
 * keeps their last seen to themselves.
 */
export function formatPresence(presence: PresenceDto | null): string | null {
  if (!presence) return null;
  switch (presence.status) {
    case 'online': {
      return 'online';
    }
    case 'offline': {
      if (presence.lastSeenAt === null) return 'last seen recently';
      return `last seen ${formatDay(presence.lastSeenAt).toLowerCase()} at ${formatTime(presence.lastSeenAt)}`;
    }
    case 'recently': {
      return 'last seen recently';
    }
    case 'within_week': {
      return 'last seen within a week';
    }
    case 'within_month': {
      return 'last seen within a month';
    }
  }
}

export function initials(title: string): string {
  const parts = title.trim().split(/\s+/).slice(0, 2);
  const letters = parts.map((part) => part[0]?.toUpperCase() ?? '').join('');
  return letters || '?';
}

/**
Preview line for the chat list.
*/
export function previewOf(text: string, media: MessageMediaDto | null, poll: MessagePollDto | null = null): string {
  if (text) return text;
  if (poll) return pollPreview(poll);
  if (media) return mediaPreview(media.kind);
  return '—';
}

/**
Label for a poll, when only the poll is known — its question is the closest
thing it has to a message body.
*/
export function pollPreview(poll: MessagePollDto): string {
  return `Poll: ${poll.question}`;
}

/**
Label for a media kind, when only the kind is known — reply headers carry a
media descriptor (not a full DTO) for cross-chat replies.
*/
export function mediaPreview(kind: MessageMediaDto['kind']): string {
  return MEDIA_PREVIEWS[kind];
}

const MEDIA_PREVIEWS: Record<MessageMediaDto['kind'], string> = {
  photo: 'Photo',
  video: 'Video',
  animation: 'GIF',
  audio: 'Audio',
  voice: 'Voice message',
  sticker: 'Sticker',
  document: 'Document',
};

/**
Human-readable byte size, e.g. `824 KB`; empty for unknown sizes.
*/
export function formatBytes(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes) || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

/**
Compact counter for values like channel-post views: `999`, `1.2K`, `123K`,
`1.2M`. Telegram's own notation, kept locale-independent so the display does
not vary with the browser locale.
*/
export function formatCount(count: number): string {
  if (count < 1000) return String(count);
  if (count < 999_500) return `${compact(count / 1000)}K`;
  if (count < 999_500_000) return `${compact(count / 1_000_000)}M`;
  return `${compact(count / 1_000_000_000)}B`;
}

/**
One decimal below 100 (dropped when it is zero), whole numbers above; the
999,5xx thresholds in `formatCount` keep the round from escaping its unit.
*/
function compact(value: number): string {
  return String(value < 100 ? Math.round(value * 10) / 10 : Math.round(value));
}
