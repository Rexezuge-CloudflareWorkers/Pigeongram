import type { Message } from '@mtcute/core';

/**
English text for the service messages the bridge renders.

mtcute leaves `Message.text` empty for service messages on purpose — the
label is the client's job — so the DTO mapper fills it here for the actions
the UI understands. Everything else stays empty, so an unsupported action
shows no label rather than a wrong one.
*/

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = 31 * DAY;
const YEAR = 365 * DAY;
const MONTHS_BEFORE_YEARS = 11;

export function serviceText(message: Message, senderName: string | null): string {
  if (!message.isService) return '';
  const action = message.action;
  if (action?.type !== 'ttl_changed') return '';
  const from = message.isOutgoing ? 'You' : (senderName ?? 'Someone');
  if (isChannel(message)) {
    return action.period > 0
      ? `Messages in this channel will be automatically deleted after ${formatTtl(action.period)}`
      : 'Messages in this channel will no longer be automatically deleted';
  }
  if (action.period <= 0) return `${from} disabled the auto-delete timer`;
  return `${from} set messages to auto-delete in ${formatTtl(action.period)}`;
}

/**
Whether the chat is a broadcast channel (or its direct-message space), where
Telegram words the change as a property of the channel rather than of a user.
*/
function isChannel(message: Message): boolean {
  const chat = message.chat;
  if (chat.type !== 'chat') return false;
  return chat.chatType === 'channel' || chat.chatType === 'monoforum';
}

/**
Telegram Desktop's `FormatTTL`: whole hours below a day, days below a week,
weeks (with a day remainder) below 31 days, then months and years. Telegram's
own presets are whole units, so the cut-offs only matter for odd values.
*/
function formatTtl(seconds: number): string {
  if (seconds < MINUTE) return count(Math.round(seconds), 'second');
  if (seconds < HOUR) return count(Math.floor(seconds / MINUTE), 'minute');
  if (seconds < DAY) return count(Math.floor(seconds / HOUR), 'hour');
  if (seconds < WEEK) return count(Math.floor(seconds / DAY), 'day');
  if (seconds < MONTH) {
    const days = Math.floor(seconds / DAY);
    const weeks = Math.floor(days / 7);
    const rest = days % 7;
    return rest === 0 ? count(weeks, 'week') : `${count(weeks, 'week')} ${count(rest, 'day')}`;
  }
  if (seconds <= MONTH * MONTHS_BEFORE_YEARS) return count(Math.floor(seconds / MONTH), 'month');
  return count(Math.round(seconds / YEAR), 'year');
}

function count(value: number, unit: string): string {
  return `${value} ${unit}${value === 1 ? '' : 's'}`;
}
