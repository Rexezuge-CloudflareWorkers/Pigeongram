import type { ChatDto, DialogDto, MessageForwardDto } from './types';

/**
 * The addresses a Telegram link or a forward can carry, and the chats they
 * name.
 *
 * A link names a public username or the raw id of a private channel; a forward
 * names a username or a marked peer id. Both are normalized here into the
 * bridge's `TelegramChatTarget`, and the loaded chat list is searched by it.
 * Pure, so the matching and the installed-app addresses can be tested without
 * a browser.
 */

/**
 * The chat a link names: a public username, or the raw id of a private
 * channel (`t.me/c/<id>`, which the bridge addresses in its marked form).
 */
export type TelegramChatRef = { username: string } | { internalId: number };

/**
 * The bridge's address for a chat: a public username or a marked peer id.
 * Exactly one of the two, matching `ResolveChatParams`.
 */
export type TelegramChatTarget = { username: string } | { chatId: number };

/**
 * The bridge target of a link's chat reference.
 */
export function linkTarget(chat: TelegramChatRef): TelegramChatTarget {
  return 'username' in chat ? { username: chat.username } : { chatId: markedChatId(chat.internalId) };
}

/**
 * The bridge target of a forwarded message's origin.
 *
 * A username is the durable address; otherwise the marked id is what the
 * engine can resolve while its peer cache still holds the chat. A hidden
 * forward, or one that names no chat, has no target.
 */
export function forwardOriginTarget(forward: MessageForwardDto): TelegramChatTarget | null {
  if (forward.senderUsername !== null) return { username: forward.senderUsername };
  const target = forward.senderId ?? forward.fromChatId;
  return target === null ? null : { chatId: target };
}

/**
 * The dialog a link's target names, when the account already has it:
 * usernames are matched case-insensitively, private-channel ids through their
 * marked form.
 */
export function findLinkedChat(dialogs: readonly DialogDto[], target: TelegramChatTarget): ChatDto | null {
  if ('username' in target) {
    const wanted = target.username.toLowerCase();
    return dialogs.find((dialog) => dialog.chat.username?.toLowerCase() === wanted)?.chat ?? null;
  }
  return dialogs.find((dialog) => dialog.chat.id === target.chatId)?.chat ?? null;
}

/**
 * The marked (bridge) id of a channel or megagroup from the raw id a
 * `t.me/c/...` link carries.
 */
export function markedChatId(internalId: number): number {
  return -(1_000_000_000_000 + internalId);
}

/**
 * The address of a public chat, for handing it to the installed app.
 *
 * A chat with a handle has two addresses: the deep link the app answers and
 * the https URL a browser falls back to. A chat without one has neither, so
 * the caller asks for a handle first.
 */
export function usernameAppLink(username: string): { deepLink: string; webUrl: string } {
  const params = new URLSearchParams({ domain: username });
  return { deepLink: `tg://resolve?${params.toString()}`, webUrl: `https://t.me/${username}` };
}

/**
 * The address of a resolved chat target, for handing a join that needs the
 * installed app (a guard bot's web view) to Telegram.
 *
 * A username has both a deep link and an https fallback. A private channel is
 * addressable by its raw id and a person by their id; neither has a web URL.
 */
export function targetAppLink(target: TelegramChatTarget): { deepLink: string; webUrl: string | null } | null {
  if ('username' in target) return usernameAppLink(target.username);
  if (target.chatId > 0) return { deepLink: `tg://user?id=${String(target.chatId)}`, webUrl: null };
  if (target.chatId < -1_000_000_000_000) {
    const internalId = -target.chatId - 1_000_000_000_000;
    return { deepLink: `tg://privatepost?channel=${String(internalId)}`, webUrl: null };
  }
  return null;
}
