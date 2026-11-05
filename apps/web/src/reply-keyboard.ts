import type { MessageDto, MessageReplyKeyboardDto } from './types';

/**
 * The chat's active reply keyboard: the keyboard a bot showed, and the id of
 * the message whose markup decided it.
 *
 * Telegram keeps a keyboard until a newer message replaces or removes it, so
 * the newest message with a reply markup is the one that counts — not the
 * newest message. The chat's window is not guaranteed to contain that message,
 * which is why a seed may stand in for it.
 */
export interface ActiveReplyKeyboard {
  /**
   * Id of the message whose markup decides the keyboard.
   */
  messageId: number;
  keyboard: Extract<MessageReplyKeyboardDto, { kind: 'keyboard' }>;
}

/**
Finds the active keyboard among the loaded messages, letting a seed stand in
for a message the window does not hold.

The seed is the newest markup-bearing message the controller has seen: a live
message that arrived while the loaded range is behind a backlog, or the newest
message the opening read probed. It wins only when it is newer than anything
the loaded messages carry, because paging can bring newer markups into view.
*/
export function activeReplyKeyboard(messages: readonly MessageDto[], seed: MessageDto | null = null): ActiveReplyKeyboard | null {
  let candidate: MessageDto | null = null;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].replyKeyboard !== null) {
      candidate = messages[index];
      break;
    }
  }
  if (seed !== null && seed.replyKeyboard !== null && (candidate === null || seed.id > candidate.id)) {
    candidate = seed;
  }
  if (candidate === null || candidate.replyKeyboard === null || candidate.replyKeyboard.kind !== 'keyboard') return null;
  return { messageId: candidate.id, keyboard: candidate.replyKeyboard };
}

/**
Advances the seed with a message the controller has seen, keeping the newest
markup-bearing one. A new message without a markup leaves the seed alone:
Telegram only replaces a keyboard when a newer message carries one. An edit
that drops the markup from the seed's own message clears it.
*/
export function foldKeyboardSeed(seed: MessageDto | null, message: MessageDto, edited = false): MessageDto | null {
  if (message.replyKeyboard === null) {
    return edited && seed !== null && seed.id === message.id ? null : seed;
  }
  if (seed !== null && message.id < seed.id) return seed;
  return message;
}
