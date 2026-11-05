import { describe, expect, it } from 'vitest';
import { activeReplyKeyboard, foldKeyboardSeed } from '../../apps/web/src/reply-keyboard';
import type { MessageDto, MessageReplyKeyboardDto } from '../../apps/web/src/types';

/**
 * The reply-keyboard derivation: which message's markup the chat is showing,
 * and how the seed a read or a live message leaves behind advances.
 */

function keyboard(overrides: Partial<Extract<MessageReplyKeyboardDto, { kind: 'keyboard' }>> = {}): MessageReplyKeyboardDto {
  return {
    kind: 'keyboard',
    rows: [[{ text: 'Yes', style: null, kind: 'text' }]],
    oneTime: false,
    placeholder: null,
    ...overrides,
  };
}

function message(id: number, replyKeyboard: MessageReplyKeyboardDto | null, overrides: Partial<MessageDto> = {}): MessageDto {
  return {
    id,
    chatId: 1,
    groupedId: null,
    senderId: 2,
    senderName: 'Helper',
    senderPhoto: null,
    outgoing: false,
    date: 1_700_000_000_000 + id,
    text: `message ${String(id)}`,
    entities: [],
    reactions: [],
    service: false,
    media: null,
    webPage: null,
    poll: null,
    markup: null,
    replyKeyboard,
    reply: null,
    forward: null,
    views: null,
    comments: null,
    ...overrides,
  };
}

describe('activeReplyKeyboard', () => {
  it('takes the newest keyboard a message carried, not the newest message', () => {
    const active = activeReplyKeyboard([message(1, keyboard()), message(2, null), message(3, null)]);
    expect(active).toEqual({ messageId: 1, keyboard: keyboard() });
  });

  it('shows nothing when a later message removed the keyboard', () => {
    expect(activeReplyKeyboard([message(1, keyboard()), message(2, { kind: 'hide' })])).toBeNull();
    expect(activeReplyKeyboard([message(1, keyboard()), message(2, { kind: 'force_reply', placeholder: null })])).toBeNull();
  });

  it('lets a newer seed stand in for a message the loaded window does not hold', () => {
    const live = message(9, keyboard({ oneTime: true }));
    expect(activeReplyKeyboard([message(1, keyboard()), message(2, null)], live)).toEqual({
      messageId: 9,
      keyboard: keyboard({ oneTime: true }),
    });
  });

  it('ignores a seed older than what the loaded messages carry', () => {
    const stale = message(1, keyboard({ oneTime: true }));
    expect(activeReplyKeyboard([message(1, keyboard()), message(2, keyboard())], stale)).toEqual({ messageId: 2, keyboard: keyboard() });
  });

  it('has nothing to show for a chat without markups', () => {
    expect(activeReplyKeyboard([message(1, null), message(2, null)])).toBeNull();
  });
});

describe('foldKeyboardSeed', () => {
  it('keeps the newest markup-bearing message', () => {
    const seed = foldKeyboardSeed(null, message(2, keyboard()));
    expect(seed?.id).toBe(2);
    expect(foldKeyboardSeed(seed, message(3, keyboard({ oneTime: true })))?.id).toBe(3);
    expect(foldKeyboardSeed(seed, message(1, keyboard()))?.id).toBe(2);
  });

  it('leaves the seed alone for a message without a markup', () => {
    const seed = message(2, keyboard());
    expect(foldKeyboardSeed(seed, message(3, null))).toBe(seed);
  });

  it('clears the seed when an edit removes the markup from its own message', () => {
    const seed = message(2, keyboard());
    expect(foldKeyboardSeed(seed, message(2, null), true)).toBeNull();
    expect(foldKeyboardSeed(seed, message(2, null))).toBe(seed);
  });
});
