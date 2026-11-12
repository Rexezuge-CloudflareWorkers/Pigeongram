import { Chat } from '@mtcute/core';
import type { tl } from '@mtcute/core';
import type { TelegramClient } from '@mtcute/core/client.js';
import type { ChatInvitePreviewDto, JoinInviteResult, ResolveInviteResult } from '../rpc-types';
import { toChatDto } from './dto';
import { EngineError } from './errors';
import { requireText } from './params';
import { rpcErrorText } from './rpc-errors';

/**
 * Private invite links (`t.me/+hash`), the one Telegram address that names a
 * chat without naming its peer.
 *
 * A public username or a marked id is a durable address; an invite hash is a
 * bearer token that only Telegram can turn into a chat. `checkChatInvite`
 * answers three ways: the account is already in the chat (`chatInviteAlready`),
 * it once was and may still read until a date (`chatInvitePeek`), or it is not
 * and Telegram describes the chat without an id (`chatInvite`). Only the first
 * two can open a thread; the third is what the join card shows before the
 * reader commits, because joining is the account's own, irreversible write.
 */

/**
 * The hash Telegram accepts in `messages.checkChatInvite`: the part after the
 * `+` or `joinchat/`. Telegram's own regex is `[\w-]+`; the cap keeps a pasted
 * document from becoming a request.
 */
const INVITE_HASH = /^[\w-]+$/;
const MAX_INVITE_LENGTH = 256;

/**
 * Telegram's three link forms, plus the bare hash the SPA carries.
 */
const INVITE_LINK = /^(?:(?:https?:\/\/)?(?:www\.)?t(?:elegram)?\.(?:me|dog|org)\/(?:joinchat\/|\+))?([\w-]+)\/?$/i;

/**
 * The failures that mean the link itself is dead, as opposed to a flood wait
 * or a privacy refusal.
 */
const EXPIRED_ERRORS = new Set(['INVITE_HASH_EXPIRED']);
const INVALID_ERRORS = new Set(['INVITE_HASH_INVALID', 'INVITE_HASH_EMPTY']);

/**
 * Resolves an invite link into the chat it names, or into the card Telegram
 * describes for a chat the account is not in.
 *
 * A resolved chat is stored in the peer cache before it is returned: a member
 * chat is normally a dialog, but the archive is read only when the reader asks
 * for it, so a link to an archived chat must not leave the following
 * `getHistory` with no access hash.
 */
export async function resolveInviteTarget(client: TelegramClient, params: Record<string, unknown>): Promise<ResolveInviteResult> {
  const hash = inviteHash(params);
  let result: tl.TypeChatInvite;
  try {
    result = await client.call({ _: 'messages.checkChatInvite', hash });
  } catch (error) {
    throw inviteFailure(error);
  }
  switch (result._) {
    case 'chatInviteAlready':
    case 'chatInvitePeek': {
      await client.storage.peers.store(result.chat);
      return { status: 'joined', chat: toChatDto(new Chat(result.chat)) };
    }
    case 'chatInvite': {
      return { status: 'preview', preview: invitePreview(result) };
    }
  }
}

/**
 * Joins the chat an invite names, or reports the outcome that needs the
 * reader: an admin's approval, or a guard bot's web view.
 *
 * Telegram answers `USER_ALREADY_PARTICIPANT` when the account joined between
 * the card and the tap. That is the state the caller wanted, so it resolves the
 * invite again instead of becoming an error.
 */
export async function joinInviteTarget(client: TelegramClient, params: Record<string, unknown>): Promise<JoinInviteResult> {
  const hash = inviteHash(params);
  let joined;
  try {
    joined = await client.joinChat(inviteLink(hash));
  } catch (error) {
    if (rpcErrorText(error) === 'USER_ALREADY_PARTICIPANT') {
      const resolved = await resolveInviteTarget(client, params);
      if (resolved.status === 'joined') return { status: 'joined', chat: resolved.chat };
    }
    throw inviteFailure(error);
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
 * The preview card's content, from the `chatInvite` Telegram answered with.
 */
function invitePreview(invite: tl.RawChatInvite): ChatInvitePreviewDto {
  return {
    title: invite.title,
    kind: invite.broadcast ? 'channel' : invite.megagroup || invite.channel ? 'supergroup' : 'group',
    memberCount: invite.participantsCount,
    withApproval: invite.requestNeeded === true,
    about: invite.about ?? null,
  };
}

/**
 * The invite hash a request carries, validated before Telegram is touched.
 */
function inviteHash(params: Record<string, unknown>): string {
  const invite = requireText(params.invite, MAX_INVITE_LENGTH).trim();
  const hash = INVITE_LINK.exec(invite)?.[1];
  if (hash === undefined || !INVITE_HASH.test(hash)) {
    throw new EngineError('invite must be an invite link or its hash', 400);
  }
  return hash;
}

function inviteLink(hash: string): string {
  return `https://t.me/+${hash}`;
}

/**
 * A dead link is its own answer, so the join card can say why it cannot be
 * joined; every other failure keeps its identity (a flood wait is not a
 * missing chat).
 */
function inviteFailure(error: unknown): unknown {
  const text = rpcErrorText(error);
  if (text !== null && EXPIRED_ERRORS.has(text)) {
    return new EngineError('This invite link has expired', 410, 'invite_expired');
  }
  if (text !== null && INVALID_ERRORS.has(text)) {
    return new EngineError('This invite link is not valid', 404, 'invite_invalid');
  }
  return error;
}
