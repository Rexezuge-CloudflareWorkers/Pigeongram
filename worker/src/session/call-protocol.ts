import type { tl } from '@mtcute/core';
import type { CallProtocolDto } from '../call-types';

/**
 * The call protocols this build speaks.
 *
 * `libraryVersions` is the ordered list of tgcalls protocol versions the
 * client supports — the preferred one first, because the server merges the
 * two peers' lists and settles on the best common version.
 *
 * `udpP2p`, `udpReflector`, `minLayer` and `maxLayer` are the values the
 * deprecated libtgvoip library used, and Telegram's documentation fixes them:
 * they are only read when the other end still speaks libtgvoip. A browser
 * cannot use that transport at all — it needs the raw UDP socket — so the
 * values are the fixed ones and the real transport is WebRTC.
 */
export const CALL_LIBRARY_VERSIONS: readonly string[] = ['13.0.0'];

export const CALL_MIN_LAYER = 65;

export const CALL_MAX_LAYER = 92;

/**
 * The protocol this client advertises in every outbound handshake.
 */
export function callProtocol(): tl.TypePhoneCallProtocol {
  return {
    _: 'phoneCallProtocol',
    udpP2p: true,
    udpReflector: true,
    minLayer: CALL_MIN_LAYER,
    maxLayer: CALL_MAX_LAYER,
    libraryVersions: [...CALL_LIBRARY_VERSIONS],
  };
}

/**
 * The advertised protocol, as the bridge serves it.
 */
export function toCallProtocolDto(protocol: tl.TypePhoneCallProtocol): CallProtocolDto {
  return {
    udpP2p: protocol.udpP2p === true,
    udpReflector: protocol.udpReflector === true,
    minLayer: protocol.minLayer,
    maxLayer: protocol.maxLayer,
    libraryVersions: [...(protocol.libraryVersions ?? [])],
  };
}
