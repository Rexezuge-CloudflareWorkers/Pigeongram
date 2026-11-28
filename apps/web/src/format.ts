import { i18n, t } from './i18n';
import type { MessageMediaDto, MessagePollDto, PresenceDto } from './types';

/**
The language the display helpers format in.

`undefined` would follow the browser's locale, which is how the app used to
behave; reading i18next's language instead means a chosen language reaches the
dates and times too, not only the sentences around them.
*/
function formatLocale(): string | undefined {
  return i18n.language || undefined;
}

function timeFormatter(): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat(formatLocale(), { hour: '2-digit', minute: '2-digit' });
}

export function formatTime(timestamp: number): string {
  return timeFormatter().format(timestamp);
}

/**
Full local date and time, used where a `title` spells out a scheduled send.
The browser's own `toLocaleString` would follow the OS locale rather than the
language the reader chose in Settings.
*/
export function formatDateTime(timestamp: number): string {
  return new Intl.DateTimeFormat(formatLocale(), {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  }).format(timestamp);
}

/**
Grouped number in the reader's chosen language: `1,234` in English, `1.234`
in German. Interpolations that used `toLocaleString()` followed the browser
instead of the app's language.
*/
export function formatNumber(value: number): string {
  return new Intl.NumberFormat(formatLocale()).format(value);
}

/**
Short stamp for the chat list: `now`, `5m`, `3h`, or `Mar 4`.
*/
export function formatListStamp(timestamp: number, now = Date.now()): string {
  const diff = now - timestamp;
  if (diff < 60_000) return t('format.now', 'Now');
  if (diff < 3_600_000) return t('format.minutes', '{{count}}m', { count: Math.max(1, Math.floor(diff / 60_000)) });
  if (diff < 86_400_000) return t('format.hours', '{{count}}h', { count: Math.floor(diff / 3_600_000) });
  return new Intl.DateTimeFormat(formatLocale(), { month: 'short', day: 'numeric' }).format(timestamp);
}

export function formatDay(timestamp: number, now = Date.now()): string {
  const date = new Date(timestamp);
  const today = new Date(now);
  if (date.toDateString() === today.toDateString()) return t('format.today', 'Today');
  const yesterday = new Date(now - 86_400_000);
  if (date.toDateString() === yesterday.toDateString()) return t('format.yesterday', 'Yesterday');
  return date.toLocaleDateString(formatLocale(), {
    month: 'short',
    day: 'numeric',
    ...(date.getFullYear() !== today.getFullYear() && { year: 'numeric' }),
  });
}

export function isSameDay(a: number, b: number): boolean {
  return new Date(a).toDateString() === new Date(b).toDateString();
}

/**
What a presence reads as: `online`, `last seen today at 14:32`, or one of
the coarse states Telegram reports when it hides the exact time. Null when
the peer has no presence at all — a bot, a group, a channel, or a person who
keeps their last seen to themselves.
*/
export function formatPresence(presence: PresenceDto | null): string | null {
  if (!presence) return null;
  switch (presence.status) {
    case 'online': {
      return t('format.presenceOnline', 'Online');
    }
    case 'offline': {
      if (presence.lastSeenAt === null) return t('format.presenceRecently', 'Last Seen Recently');
      return t('format.presenceLastSeen', 'Last Seen {{day}} At {{time}}', {
        day: formatDay(presence.lastSeenAt),
        time: formatTime(presence.lastSeenAt),
      });
    }
    case 'recently': {
      return t('format.presenceRecently', 'Last Seen Recently');
    }
    case 'within_week': {
      return t('format.presenceWeek', 'Last Seen Within A Week');
    }
    case 'within_month': {
      return t('format.presenceMonth', 'Last Seen Within A Month');
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

A document previews its file name, which is what the official clients show
beside the document glyph; the kind's label is only the fallback for a document
Telegram sent without a name. Every other kind falls back to its label, and a
caption outranks both — the caption is the text the peer wrote.
*/
export function previewOf(text: string, media: MessageMediaDto | null, poll: MessagePollDto | null = null): string {
  if (text) return text;
  if (poll) return pollPreview(poll);
  if (media) return media.kind === 'document' && media.fileName ? media.fileName : mediaPreview(media.kind, media.emoji);
  return '—';
}

/**
Label for a poll, when only the poll is known — its question is the closest
thing it has to a message body.
*/
export function pollPreview(poll: MessagePollDto): string {
  return t('format.pollPreview', 'Poll: {{question}}', { question: poll.question });
}

/**
Label for a media kind, when only the kind is known — reply headers carry a
media descriptor (not a full DTO) for cross-chat replies.

A sticker also carries the emoji Telegram associated with it, which is what the
official clients put on the chat list's preview line.
*/
export function mediaPreview(kind: MessageMediaDto['kind'], emoji?: string): string {
  if (kind === 'sticker' && emoji) return t('format.stickerWithEmoji', '{{emoji}} Sticker', { emoji });
  return mediaLabel(kind);
}

/**
The label a media kind is described by. Keys are spelled out per kind rather
than composed, because the kit's call-site check reads literal translation
keys and a computed one would be invisible to it.
*/
function mediaLabel(kind: MessageMediaDto['kind']): string {
  switch (kind) {
    case 'photo': {
      return t('format.media.photo', 'Photo');
    }
    case 'video': {
      return t('format.media.video', 'Video');
    }
    case 'animation': {
      return t('format.media.animation', 'GIF');
    }
    case 'audio': {
      return t('format.media.audio', 'Audio');
    }
    case 'voice': {
      return t('format.media.voice', 'Voice Message');
    }
    case 'sticker': {
      return t('format.media.sticker', 'Sticker');
    }
    case 'document': {
      return t('format.media.document', 'Document');
    }
    case 'widget': {
      return t('format.media.widget', 'Widget');
    }
    case 'unsupported': {
      return t('format.media.unsupported', 'Unsupported Message');
    }
  }
}

/**
Human-readable byte size, e.g. `824 KB`; empty for unknown sizes.
*/
export function formatBytes(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes) || bytes <= 0) return '';
  if (bytes < 1024) return `${decimal(bytes, 0)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${decimal(value, value < 10 ? 1 : 0, value < 10 ? 1 : 0)} ${units[unit]}`;
}

/**
Compact counter for values like channel-post views: `999`, `1.2K`, `123K`,
`1.2M`. Telegram's own notation is kept, but the decimal separator follows
the chosen language (`1,2K` in German, `1.2K` in English).
*/
export function formatCount(count: number): string {
  if (count < 1000) return decimal(count, 0);
  if (count < 999_500) return `${compact(count / 1000)}K`;
  if (count < 999_500_000) return `${compact(count / 1_000_000)}M`;
  return `${compact(count / 1_000_000_000)}B`;
}

/**
One decimal below 100 (dropped when it is zero), whole numbers above; the
999,5xx thresholds in `formatCount` keep the round from escaping its unit.
*/
function compact(value: number): string {
  return decimal(value < 100 ? Math.round(value * 10) / 10 : Math.round(value), 0, value < 100 ? 1 : 0);
}

/**
A number without grouping, with the chosen language's decimal separator.
Byte sizes and compact counters must not gain thousands separators.
*/
function decimal(value: number, minimumFractionDigits: number, maximumFractionDigits = minimumFractionDigits): string {
  return new Intl.NumberFormat(formatLocale(), {
    useGrouping: false,
    minimumFractionDigits,
    maximumFractionDigits,
  }).format(value);
}
