import type { tl } from '@mtcute/core';
import type { CallConnectionDto, CallDto, CallProtocolDto, CallState } from '../call-types';
import { encodeBase64 } from './base64';
import { toCallProtocolDto } from './call-protocol';

/**
 * Turns Telegram's call constructors into the DTO the bridge serves.
 *
 * The six constructors are the six states a call can be in, so the mapping is
 * one word per constructor and no interpretation beyond that. The access hash
 * is deliberately left out: it stays in the engine, and the browser names a
 * call by its id alone.
 */

/**
 * The friendly name of a discard reason, and the wire constructor behind it.
 *
 * Telegram's reasons are constructors, so the wire name is what the engine
 * sends and the friendly name is what the bridge accepts.
 */
const DISCARD_REASONS: ReadonlyMap<string, string> = new Map([
  ['phoneCallDiscardReasonMissed', 'missed'],
  ['phoneCallDiscardReasonDisconnect', 'disconnect'],
  ['phoneCallDiscardReasonHangup', 'hangup'],
  ['phoneCallDiscardReasonBusy', 'busy'],
]);

/**
 * The wire constructor of a friendly discard reason.
 */
export function discardReasonConstructor(reason: string): string {
  switch (reason) {
    case 'missed': {
      return 'phoneCallDiscardReasonMissed';
    }
    case 'disconnect': {
      return 'phoneCallDiscardReasonDisconnect';
    }
    case 'hangup': {
      return 'phoneCallDiscardReasonHangup';
    }
    case 'busy': {
      return 'phoneCallDiscardReasonBusy';
    }
    default: {
      return 'phoneCallDiscardReasonHangup';
    }
  }
}

/**
 * The state a constructor stands for.
 */
function stateOf(call: tl.TypePhoneCall): CallState {
  switch (call._) {
    case 'phoneCallEmpty': {
      return 'empty';
    }
    case 'phoneCallWaiting': {
      return 'waiting';
    }
    case 'phoneCallRequested': {
      return 'requested';
    }
    case 'phoneCallAccepted': {
      return 'accepted';
    }
    case 'phoneCall': {
      return 'active';
    }
    default: {
      return 'discarded';
    }
  }
}

/**
 * The call's access hash, when the constructor carries one.
 *
 * The discarded constructor does not: by then the call is over and nothing
 * has to be addressed to it any more.
 */
export function callAccessHash(call: tl.TypePhoneCall): string | null {
  return call._ === 'phoneCallDiscarded' || call._ === 'phoneCallEmpty' ? null : call.accessHash.toString();
}

/**
 * One way into the call's media.
 */
function toConnectionDto(connection: tl.TypePhoneConnection): CallConnectionDto {
  if (connection._ === 'phoneConnectionWebrtc') {
    return {
      id: connection.id.toString(),
      ip: connection.ip,
      ipv6: connection.ipv6,
      port: connection.port,
      turn: connection.turn === true,
      stun: connection.stun === true,
      username: connection.username,
      password: connection.password,
      tcp: false,
      peerTag: '',
    };
  }
  return {
    id: connection.id.toString(),
    ip: connection.ip,
    ipv6: connection.ipv6,
    port: connection.port,
    turn: false,
    stun: false,
    username: '',
    password: '',
    tcp: connection.tcp === true,
    peerTag: encodeBase64(connection.peerTag),
  };
}

/**
 * The protocol of a call that carries none.
 */
function emptyProtocol(): CallProtocolDto {
  return toCallProtocolDto({ _: 'phoneCallProtocol', minLayer: 0, maxLayer: 0, libraryVersions: [] });
}

/**
 * The DTO the bridge serves for a call.
 */
export function toCallDto(call: tl.TypePhoneCall): CallDto {
  if (call._ === 'phoneCallEmpty') {
    return {
      id: call.id.toString(),
      date: 0,
      adminId: 0,
      participantId: 0,
      video: false,
      p2pAllowed: false,
      conferenceSupported: false,
      state: 'empty',
      protocol: emptyProtocol(),
      connections: [],
    };
  }
  if (call._ === 'phoneCallDiscarded') {
    return {
      id: call.id.toString(),
      date: 0,
      adminId: 0,
      participantId: 0,
      video: call.video === true,
      p2pAllowed: false,
      conferenceSupported: false,
      state: 'discarded',
      protocol: emptyProtocol(),
      connections: [],
      needRating: call.needRating === true,
      ...(call.reason && { discardReason: DISCARD_REASONS.get(call.reason._) ?? 'disconnect' }),
      ...(call.duration !== undefined && { duration: call.duration }),
    };
  }
  const dto: CallDto = {
    id: call.id.toString(),
    date: call.date,
    adminId: call.adminId,
    participantId: call.participantId,
    video: call.video === true,
    p2pAllowed: call._ === 'phoneCall' ? call.p2pAllowed === true : false,
    conferenceSupported: call._ === 'phoneCall' ? call.conferenceSupported === true : false,
    state: stateOf(call),
    protocol: toCallProtocolDto(call.protocol),
    connections: call._ === 'phoneCall' ? call.connections.map(toConnectionDto) : [],
  };
  if (call._ === 'phoneCallRequested') {
    return { ...dto, gAHash: encodeBase64(call.gAHash) };
  }
  if (call._ === 'phoneCallAccepted') {
    return { ...dto, gB: encodeBase64(call.gB) };
  }
  if (call._ === 'phoneCall') {
    return {
      ...dto,
      gAOrB: encodeBase64(call.gAOrB),
      keyFingerprint: call.keyFingerprint.toString(),
      startDate: call.startDate,
    };
  }
  return dto;
}
