import type { MessageReactionDto } from './types';

/**
 * The reaction emoji the context menu offers without expanding it. Telegram's
 * quick strip leads with these; keeping the set small is what leaves room for
 * the expand affordance on a narrow screen.
 */
export const QUICK_REACTIONS: readonly string[] = ['👍', '❤️', '🔥', '🥰', '👏', '😁', '🤔'];

/**
 * The standard unicode reactions Telegram accepts (`messages.getAvailableReactions`).
 * Paid reactions (`⭐`) and custom emoji are deliberately absent: the bridge has
 * no paid-reaction call, and custom emoji are addressed by document id.
 */
export const ALL_REACTIONS: readonly string[] = [
  '👍',
  '👎',
  '❤️',
  '🔥',
  '🥰',
  '👏',
  '😁',
  '🤔',
  '🤯',
  '😱',
  '🤬',
  '😢',
  '🎉',
  '🤩',
  '🤮',
  '💩',
  '🙏',
  '👌',
  '🕊️',
  '🤡',
  '🥱',
  '🥴',
  '😍',
  '🐳',
  '❤️‍🔥',
  '🌚',
  '🌭',
  '💯',
  '🤣',
  '⚡',
  '🍌',
  '🏆',
  '💔',
  '🤨',
  '😐',
  '🍓',
  '🍾',
  '💋',
  '🖕',
  '😈',
  '😴',
  '😭',
  '🤓',
  '👻',
  '👨‍💻',
  '👀',
  '🎃',
  '🙈',
  '😇',
  '😨',
  '🤝',
  '✍️',
  '🤗',
  '🫡',
  '🎅',
  '🎄',
  '☃️',
  '💅',
  '🤪',
  '🗿',
  '🆒',
  '💘',
  '🙉',
  '🦄',
  '😘',
  '💊',
  '🙊',
  '😎',
  '👾',
  '🤷‍♂️',
  '🤷',
  '🤷‍♀️',
  '😡',
];

/**
 * The reaction to hand back for an emoji the reader picked. An existing
 * aggregate is returned untouched because its `chosen` flag decides whether
 * the bridge call sets or removes the reaction — a synthetic `chosen: false`
 * would make tapping the current reaction send it again instead of clearing
 * it.
 *
 * Matches across `U+FE0F`: Telegram omits the variation selector on some
 * reactions, and the picker's presentation forms always carry it.
 */
export function reactionFor(reactions: readonly MessageReactionDto[], emoji: string): MessageReactionDto {
  const key = reactionKey(emoji);
  return (
    reactions.find((reaction) => reaction.emoji !== null && reactionKey(reaction.emoji) === key) ?? {
      emoji,
      customEmojiId: null,
      count: 0,
      chosen: false,
    }
  );
}

function reactionKey(emoji: string): string {
  return emoji.replaceAll('\uFE0F', '');
}
