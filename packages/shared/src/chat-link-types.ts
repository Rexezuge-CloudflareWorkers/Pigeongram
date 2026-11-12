/**
 * The link and forward half of the bridge contract: resolving a chat named by
 * a public username, a marked peer id or an invite link, and joining one the
 * account has not joined yet. Split from `rpc-types.ts` so the method shapes
 * stay under the god-file cap; the SPA re-exports these types from
 * `apps/web/src/types.ts`.
 */

import type { ChatDto, PeerId } from './types';

/**
 * The chat a link or a forward names, exactly one of a public username and a
 * marked peer id.
 *
 * A username is the durable address: the engine's peer cache is memory-only,
 * so after a restart a bare marked id may carry no access hash while the
 * username resolves again.
 */
export interface ResolveChatParams {
  username?: string;
  chatId?: PeerId;
}

/**
 * A chat the bridge resolved for a link: its DTO and whether the account is in
 * it. A public channel or supergroup the account has not joined is readable
 * but a preview — the SPA offers Join rather than a composer that would fail.
 */
export interface ResolveChatResult {
  chat: ChatDto;
  member: boolean;
}

/**
 * The preview of a private invite link (`t.me/+hash`) the account has not
 * joined yet.
 *
 * Telegram's `chatInvite` carries no peer, so there is nothing to open: only
 * what the join card can show before the reader commits. A link to a chat the
 * account already belongs to resolves to the chat itself instead.
 */
export interface ChatInvitePreviewDto {
  title: string;
  kind: 'group' | 'supergroup' | 'channel';
  memberCount: number;
  /**
   * The join needs an admin's approval before the account gets in.
   */
  withApproval: boolean;
  about: string | null;
}

/**
 * An invite link to resolve: the hash it carries, or the link itself.
 */
export interface ResolveInviteParams {
  invite: string;
}

/**
 * A resolved invite: the chat when the account is already in it, or the card
 * Telegram describes for one it is not.
 */
export type ResolveInviteResult = { status: 'joined'; chat: ChatDto } | { status: 'preview'; preview: ChatInvitePreviewDto };

export interface JoinInviteParams {
  invite: string;
}

export interface JoinChatParams {
  username?: string;
  chatId?: PeerId;
}

export interface JoinChatResult {
  /**
   * `joined` means the account is in the chat now (or already was);
   * `request_sent` that an admin has to approve the request; `webview` that a
   * guard bot wants its web view opened before the join can finish.
   */
  status: 'joined' | 'request_sent' | 'webview';
  /**
   * The chat as Telegram returned it after a successful join; null when
   * Telegram returned no chat (a pending request or a guard bot).
   */
  chat: ChatDto | null;
}

/**
 * Joining through an invite answers the same three outcomes as joining a
 * public chat, because Telegram's `importChatInvite` reports them the same way.
 */
export type JoinInviteResult = JoinChatResult;
