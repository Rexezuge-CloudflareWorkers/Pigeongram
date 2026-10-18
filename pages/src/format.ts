import type { MessageMediaDto } from './types';

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

export function initials(title: string): string {
  const parts = title.trim().split(/\s+/).slice(0, 2);
  const letters = parts.map((part) => part[0]?.toUpperCase() ?? '').join('');
  return letters || '?';
}

/**
Preview line for the chat list.
*/
export function previewOf(text: string, media: MessageMediaDto | null): string {
  if (text) return text;
  if (media) return MEDIA_PREVIEWS[media.kind];
  return '—';
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
