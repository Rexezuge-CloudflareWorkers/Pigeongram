import { Long } from '@mtcute/core';
import type { tl } from '@mtcute/core';
import type { TelegramClient } from '@mtcute/core/client.js';
import type { CallRpcMethod, CallResult, GetCallDhConfigResult } from '../call-types';
import { encodeBase64 } from './base64';
import { discardReasonConstructor, toCallDto } from './call-dto';
import {
  requireCallId,
  requireCallRandomId,
  requireComment,
  requireDhHash,
  requireDhValue,
  requireDiscardReason,
  requireDuration,
  requireFingerprint,
  requireRating,
} from './call-params';
import { callProtocol } from './call-protocol';
import type { CallRegistry } from './call-registry';
import { EngineError } from './errors';
import { requirePeerId } from './params';
import type { PartialMethodTable } from './rpc-methods';

/**
 * The calls half of the bridge.
 *
 * A call is a two-sided thing: Telegram's server relays the handshake and the
 * signalling packets between the two peers, and everything else — the audio,
 * the video — travels directly between them. So the bridge's job is narrow:
 * it holds the account's session, it carries the handshake, and it relays the
 * signalling packets. The media never comes near it.
 *
 * The one thing the bridge deliberately does not carry is the shared key.
 * The Diffie-Hellman exchange happens in the browser, and only the values
 * Telegram's protocol puts on the wire travel through here.
 */

/**
 * How many random bytes the Diffie-Hellman config is asked for.
 *
 * The secret is 256 bytes wide, and the config's `random` is the server's
 * contribution to the exchange.
 */
const DH_RANDOM_LENGTH = 256;

/**
 * The calls surface, as one entry per method.
 *
 * The registry spreads this table in with the rest of the bridge's methods, so
 * a call method is no longer a special case in the dispatcher: it is an
 * ordinary entry that happens to be a write. The table's type covers every
 * member of {@link CallRpcMethod}, so adding one to the contract fails the
 * build until it is classified here.
 */
export const callRpcMethods = {
  getCallDhConfig: {
    readOnly: false,
    run: async (context) => readDhConfig(context.client),
  },

  requestCall: {
    readOnly: false,
    run: async (context, params) => {
      const chatId = requirePeerId(params.chatId);
      const gAHash = requireDhHash(params.gAHash, 'gAHash');
      const randomId = requireCallRandomId(params.randomId);
      const userId = await context.client.resolveUser(chatId);
      const result = await context.client.call({
        _: 'phone.requestCall',
        video: false,
        userId,
        randomId,
        gAHash,
        protocol: callProtocol(),
      });
      return remember(context.calls, result.phoneCall);
    },
  },

  receivedCall: {
    readOnly: false,
    run: async (context, params) => {
      const callId = requireCallId(params.callId);
      await context.client.call({ _: 'phone.receivedCall', peer: inputPhoneCall(callId, context.calls) });
      return {};
    },
  },

  acceptCall: {
    readOnly: false,
    run: async (context, params) => {
      const callId = requireCallId(params.callId);
      const gB = requireDhValue(params.gB, 'gB');
      const result = await context.client.call({
        _: 'phone.acceptCall',
        peer: inputPhoneCall(callId, context.calls),
        gB,
        protocol: callProtocol(),
      });
      return remember(context.calls, result.phoneCall);
    },
  },

  confirmCall: {
    readOnly: false,
    run: async (context, params) => {
      const callId = requireCallId(params.callId);
      const gA = requireDhValue(params.gA, 'gA');
      const keyFingerprint = requireFingerprint(params.keyFingerprint);
      const result = await context.client.call({
        _: 'phone.confirmCall',
        peer: inputPhoneCall(callId, context.calls),
        gA,
        keyFingerprint,
        protocol: callProtocol(),
      });
      return remember(context.calls, result.phoneCall);
    },
  },

  discardCall: {
    readOnly: false,
    run: async (context, params) => {
      const callId = requireCallId(params.callId);
      const reason = requireDiscardReason(params.reason);
      const duration = requireDuration(params.duration);
      const video = params.video === true;
      await context.client.call({
        _: 'phone.discardCall',
        video,
        peer: inputPhoneCall(callId, context.calls),
        duration,
        reason: { _: discardReasonConstructor(reason) } as tl.TypePhoneCallDiscardReason,
        connectionId: Long.ZERO,
      });
      context.calls.forget(callId.toString());
      return {};
    },
  },

  rateCall: {
    readOnly: false,
    run: async (context, params) => {
      const callId = requireCallId(params.callId);
      const rating = requireRating(params.rating);
      const comment = params.comment === undefined ? '' : requireComment(params.comment);
      await context.client.call({
        _: 'phone.setCallRating',
        peer: inputPhoneCall(callId, context.calls),
        rating,
        comment,
      });
      context.calls.forget(callId.toString());
      return {};
    },
  },
} as const satisfies PartialMethodTable<CallRpcMethod>;

/**
 * Relays one signalling packet to the other peer.
 *
 * Telegram's server carries the packet; the engine never reads it. The
 * packet is only meaningful once the key exchange is over, so it is refused
 * for a call the engine does not know.
 */
export async function sendCallSignaling(client: TelegramClient, calls: CallRegistry, callId: string, data: Uint8Array): Promise<void> {
  const id = requireCallId(callId);
  await client.call({ _: 'phone.sendSignalingData', peer: inputPhoneCall(id, calls), data });
}

/**
 * The Diffie-Hellman prime and generator the key exchange runs on.
 *
 * The prime is public: both peers get it from the same server, and it is the
 * generator that makes the exchange work. The secret is the browser's.
 */
async function readDhConfig(client: TelegramClient): Promise<GetCallDhConfigResult> {
  const config = await client.call({ _: 'messages.getDhConfig', version: 0, randomLength: DH_RANDOM_LENGTH });
  if (config._ !== 'messages.dhConfig') {
    throw new EngineError('The Diffie-Hellman config came back without a prime', 502);
  }
  return { g: config.g, p: encodeBase64(config.p), version: config.version };
}

/**
 * Remembers a call the engine has just seen and serves it as the DTO.
 */
function remember(calls: CallRegistry, call: tl.TypePhoneCall): CallResult {
  calls.remember(call);
  return { call: toCallDto(call) };
}

/**
 * The peer a call method addresses: the call's id and the access hash the
 * engine kept for it.
 */
function inputPhoneCall(callId: ReturnType<typeof requireCallId>, calls: CallRegistry): tl.TypeInputPhoneCall {
  return {
    _: 'inputPhoneCall',
    id: callId,
    accessHash: Long.fromString(calls.accessHash(callId.toString())),
  };
}
