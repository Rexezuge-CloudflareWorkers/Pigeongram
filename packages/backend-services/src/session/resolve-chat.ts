import { MtPeerNotFoundError } from '@mtcute/core';
import type { Peer } from '@mtcute/core';
import type { TelegramClient } from '@mtcute/core/client.js';
import type { JoinChatResult, ResolveChatResult } from '../rpc-types';
import { toChatDto } from './dto';
import { EngineError } from './errors';
import { requirePeerId } from './params';
import { rpcErrorText } from './rpc-errors';

/**
 * Resolving a chat a link or a forward names, and joining it.
 *
 * A link carries a public username or a marked peer id, never an access hash.
 * The engine is the only side that can turn either into a peer, and a username
 * is the durable address: the peer cache is memory-only, so after a restart a
 * bare marked id may be unresolvable while the username still works.
 *
 * A resolved chat can be one the account is not in — a public channel or
 * supergroup is readable as a preview. `member` is what tells the SPA to offer
 * Join instead of a composer whose send would fail.
 */

/**
 * The bridge-shaped target: exactly one of a username and a marked peer id.
 */
export type ChatTarget = { username: string } | { chatId: number };

/**
 * A public Telegram username: it starts with a letter and may carry digits and
 * underscores. The leading `@` is accepted and normalized away.
 */
const USERNAME = /^@?[a-z]\w{2,31}$/i;

/**
 * The failures that mean the target does not exist, or that this session has
 * no usable access hash for it. A link for one of these falls back to the
 * installed app, so the bridge answers a 404 rather than an upstream failure.
 */
const NOT_FOUND_ERRORS = new Set(['USERNAME_NOT_OCCUPIED', 'USERNAME_INVALID', 'PEER_ID_INVALID', 'CHANNEL_INVALID', 'USER_ID_INVALID']);

/**
 * Resolves a link's target into the chat DTO and whether the account is in it.
 */
export async function resolveChatTarget(client: TelegramClient, params: Record<string, unknown>): Promise<ResolveChatResult> {
  const target = parseChatTarget(params);
  const peer = await resolvePeer(client, target);
  return { chat: toChatDto(peer), member: isMember(peer) };
}

/**
 * Joins the chat a link names, or reports why it cannot.
 *
 * The chat is resolved first, both to answer "already a member" without a
 * write and to prefer its username when joining: the username re-resolves even
 * when the peer cache was lost with the previous wake.
 */
export async function joinChatTarget(client: TelegramClient, params: Record<string, unknown>): Promise<JoinChatResult> {
  const target = parseChatTarget(params);
  const peer = await resolvePeer(client, target);
  if (isMember(peer)) {
    return { status: 'joined', chat: toChatDto(peer) };
  }
  // The resolved DTO is the source of the username; the request itself is the
  // fallback for a peer Telegram did not describe with one.
  const address = toChatDto(peer).username ?? ('username' in target ? target.username : target.chatId);
  let joined;
  try {
    joined = await client.joinChat(address);
  } catch (error) {
    throw notFoundOr(error);
  }
  switch (joined.status) {
    case 'ok': {
      return { status: 'joined', chat: toChatDto(joined.chat) };
    }
    case 'request_sent': {
      return { status: 'request_sent', chat: null };
    }
    case 'webview': {
      return { status: 'webview', chat: null };
    }
  }
}

/**
 * The target a link or forward names, validated before Telegram is touched.
 */
function parseChatTarget(params: Record<string, unknown>): ChatTarget {
  const hasUsername = params.username !== undefined && params.username !== null;
  const hasChatId = params.chatId !== undefined && params.chatId !== null;
  if (hasUsername === hasChatId) {
    throw new EngineError('exactly one of username or chatId is required', 400);
  }
  if (hasUsername) {
    if (typeof params.username !== 'string' || !USERNAME.test(params.username)) {
      throw new EngineError('username must be a Telegram username', 400);
    }
    return { username: params.username.replace(/^@/, '').toLowerCase() };
  }
  return { chatId: requirePeerId(params.chatId) };
}

/**
 * Resolves a parsed target, mapping a missing or unusable peer onto a 404.
 */
async function resolvePeer(client: TelegramClient, target: ChatTarget): Promise<Peer> {
  try {
    return await client.getPeer('username' in target ? target.username : target.chatId);
  } catch (error) {
    throw notFoundOr(error);
  }
}

/**
 * Whether the account is in the chat: users always are, a chat says so itself.
 */
function isMember(peer: Peer): boolean {
  return peer.type === 'chat' ? peer.isMember : true;
}

/**
 * A peer Telegram could not resolve is a 404; every other failure keeps its
 * own identity, so a flood wait is not mistaken for a missing chat.
 */
function notFoundOr(error: unknown): unknown {
  if (error instanceof MtPeerNotFoundError) {
    return new EngineError('Chat not found', 404, 'not_found');
  }
  const text = rpcErrorText(error);
  if (text !== null && NOT_FOUND_ERRORS.has(text)) {
    return new EngineError('Chat not found', 404, 'not_found');
  }
  return error;
}
