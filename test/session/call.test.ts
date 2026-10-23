import { Long } from '@mtcute/core';
import type { tl } from '@mtcute/core';
import type { TelegramClient } from '@mtcute/core/client.js';
import { describe, expect, it } from 'vitest';
import { callAccessHash, discardReasonConstructor, toCallDto } from '../../worker/src/session/call-dto';
import {
  requireBytes,
  requireCallId,
  requireCallRandomId,
  requireDhHash,
  requireDhValue,
  requireDiscardReason,
  requireDuration,
  requireFingerprint,
  requireRating,
} from '../../worker/src/session/call-params';
import { callProtocol, toCallProtocolDto } from '../../worker/src/session/call-protocol';
import { dispatchCallRpc } from '../../worker/src/session/call-rpc';
import { CallRegistry } from '../../worker/src/session/call-registry';
import { EngineError } from '../../worker/src/session/errors';
import { encodeBase64 } from '../../worker/src/session/base64';

/**
 * The calls half of the bridge.
 *
 * A call is addressed by its id and an access hash, and the hash never
 * crosses the bridge — so the DTO carries neither, and the engine's registry
 * is what turns an id into something addressable.
 */

const protocol: tl.TypePhoneCallProtocol = {
  _: 'phoneCallProtocol',
  udpP2p: true,
  udpReflector: true,
  minLayer: 65,
  maxLayer: 92,
  libraryVersions: ['13.0.0'],
};

const waiting: tl.TypePhoneCall = {
  _: 'phoneCallWaiting',
  id: Long.fromNumber(1000),
  accessHash: Long.fromNumber(555),
  date: 1_700_000_000,
  adminId: 1,
  participantId: 2,
  protocol,
};

describe('the call DTO', () => {
  it('names the state after the constructor it came from', () => {
    expect(toCallDto(waiting).state).toBe('waiting');
    expect(toCallDto({ _: 'phoneCallEmpty', id: Long.fromNumber(1) }).state).toBe('empty');
    expect(
      toCallDto({
        _: 'phoneCallRequested',
        id: Long.fromNumber(2),
        accessHash: Long.fromNumber(3),
        date: 1,
        adminId: 1,
        participantId: 2,
        gAHash: new Uint8Array(32),
        protocol,
      }).state,
    ).toBe('requested');
    expect(
      toCallDto({
        _: 'phoneCallAccepted',
        id: Long.fromNumber(2),
        accessHash: Long.fromNumber(3),
        date: 1,
        adminId: 1,
        participantId: 2,
        gB: new Uint8Array(256),
        protocol,
      }).state,
    ).toBe('accepted');
    expect(
      toCallDto({
        _: 'phoneCall',
        id: Long.fromNumber(2),
        accessHash: Long.fromNumber(3),
        date: 1,
        adminId: 1,
        participantId: 2,
        gAOrB: new Uint8Array(256),
        keyFingerprint: Long.fromNumber(-42),
        protocol,
        connections: [],
        startDate: 5,
      }).state,
    ).toBe('active');
    expect(toCallDto({ _: 'phoneCallDiscarded', id: Long.fromNumber(2) }).state).toBe('discarded');
  });

  it('never carries the access hash', () => {
    const dto = toCallDto(waiting);
    expect(JSON.stringify(dto)).not.toContain('555');
    expect('accessHash' in dto).toBe(false);
  });

  it('carries the byte payloads as base64', () => {
    const gAHash = new Uint8Array(32).fill(7);
    const dto = toCallDto({
      _: 'phoneCallRequested',
      id: Long.fromNumber(2),
      accessHash: Long.fromNumber(3),
      date: 1,
      adminId: 1,
      participantId: 2,
      gAHash,
      protocol,
    });
    expect(dto.gAHash).toBe(encodeBase64(gAHash));
  });

  it('serves the endpoints of the call', () => {
    const dto = toCallDto({
      _: 'phoneCall',
      id: Long.fromNumber(2),
      accessHash: Long.fromNumber(3),
      date: 1,
      adminId: 1,
      participantId: 2,
      gAOrB: new Uint8Array(256),
      keyFingerprint: Long.fromNumber(7),
      protocol,
      connections: [
        {
          _: 'phoneConnectionWebrtc',
          turn: true,
          stun: true,
          id: Long.fromNumber(9),
          ip: '203.0.113.7',
          ipv6: '',
          port: 3478,
          username: 'user',
          password: 'secret',
        },
      ],
      startDate: 5,
    });
    expect(dto.connections).toHaveLength(1);
    expect(dto.connections[0]).toMatchObject({ ip: '203.0.113.7', port: 3478, turn: true, stun: true });
  });

  it('maps the discard reasons onto their friendly names', () => {
    expect(discardReasonConstructor('missed')).toBe('phoneCallDiscardReasonMissed');
    expect(discardReasonConstructor('hangup')).toBe('phoneCallDiscardReasonHangup');
    expect(discardReasonConstructor('busy')).toBe('phoneCallDiscardReasonBusy');
    const dto = toCallDto({
      _: 'phoneCallDiscarded',
      id: Long.fromNumber(2),
      reason: { _: 'phoneCallDiscardReasonMissed' } as tl.TypePhoneCallDiscardReason,
      duration: 12,
    });
    expect(dto.discardReason).toBe('missed');
    expect(dto.duration).toBe(12);
  });

  it('reads the access hash off a call, but not off a discarded one', () => {
    expect(callAccessHash(waiting)).toBe('555');
    expect(callAccessHash({ _: 'phoneCallDiscarded', id: Long.fromNumber(2) })).toBeNull();
    expect(callAccessHash({ _: 'phoneCallEmpty', id: Long.fromNumber(2) })).toBeNull();
  });
});

describe('the call protocol', () => {
  it('advertises the fixed values of the deprecated transport', () => {
    expect(callProtocol()).toMatchObject({
      _: 'phoneCallProtocol',
      udpP2p: true,
      udpReflector: true,
      minLayer: 65,
      maxLayer: 92,
      libraryVersions: ['13.0.0'],
    });
  });

  it('serves the protocol as the bridge serves it', () => {
    expect(toCallProtocolDto(protocol)).toEqual({
      udpP2p: true,
      udpReflector: true,
      minLayer: 65,
      maxLayer: 92,
      libraryVersions: ['13.0.0'],
    });
  });
});

describe('the registry of calls', () => {
  it('remembers the access hash of a call it has seen', () => {
    const registry = new CallRegistry();
    registry.remember(waiting);
    expect(registry.accessHash('1000')).toBe('555');
    expect(registry.knows('1000')).toBe(true);
  });

  it('refuses a call it has never seen', () => {
    const registry = new CallRegistry();
    expect(() => registry.accessHash('404')).toThrow(EngineError);
  });

  it('forgets a discarded call', () => {
    const registry = new CallRegistry();
    registry.remember(waiting);
    registry.forget('1000');
    expect(registry.knows('1000')).toBe(false);
  });
});

describe('the requestCall dispatch', () => {
  it('hands the caller commitment to Telegram as the 32-byte hash', async () => {
    const requests: unknown[] = [];
    const client = {
      resolveUser: async (chatId: number) => ({ _: 'inputUser', userId: chatId, accessHash: Long.fromNumber(1) }),
      call: async (request: unknown) => {
        requests.push(request);
        return { phoneCall: waiting };
      },
    } as unknown as TelegramClient;
    const gAHash = new Uint8Array(32).fill(9);

    await dispatchCallRpc(client, 'requestCall', { chatId: 2, gAHash: encodeBase64(gAHash), randomId: '7' }, new CallRegistry());

    expect(requests).toHaveLength(1);
    const request = requests[0] as { _: string; gAHash: Uint8Array };
    expect(request._).toBe('phone.requestCall');
    expect(request.gAHash).toEqual(gAHash);
  });
});

describe('the validation of the call parameters', () => {
  it('requires the Diffie-Hellman values to be 256 bytes', () => {
    expect(requireDhValue(encodeBase64(new Uint8Array(256)), 'gA')).toHaveLength(256);
    expect(() => requireDhValue(encodeBase64(new Uint8Array(255)), 'gA')).toThrow(EngineError);
    expect(() => requireDhValue('not base64!', 'gA')).toThrow(EngineError);
    expect(() => requireDhValue(42, 'gA')).toThrow(EngineError);
  });

  it('takes the caller commitment as a 32-byte hash, not a Diffie-Hellman value', () => {
    expect(requireDhHash(encodeBase64(new Uint8Array(32)), 'gAHash')).toHaveLength(32);
    expect(() => requireDhHash(encodeBase64(new Uint8Array(31)), 'gAHash')).toThrow(EngineError);
    expect(() => requireDhHash(encodeBase64(new Uint8Array(33)), 'gAHash')).toThrow(EngineError);
    // The value the commitment hashes is 256 bytes; the commitment is not.
    expect(() => requireDhHash(encodeBase64(new Uint8Array(256)), 'gAHash')).toThrow(EngineError);
  });

  it('requires the call ids to be decimal 64-bit numbers', () => {
    expect(requireCallId('1234567890123456789').toString()).toBe('1234567890123456789');
    expect(() => requireCallId('12a')).toThrow(EngineError);
    expect(() => requireCallId(12)).toThrow(EngineError);
  });

  it('requires the key fingerprint to be a decimal 64-bit number', () => {
    expect(requireFingerprint('-9223372036854775808').toString()).toBe('-9223372036854775808');
    expect(() => requireFingerprint('1.5')).toThrow(EngineError);
  });

  it('requires the random id to be a positive 32-bit number', () => {
    expect(requireCallRandomId('42')).toBe(42);
    expect(() => requireCallRandomId('0')).toThrow(EngineError);
    expect(() => requireCallRandomId('4294967296')).toThrow(EngineError);
  });

  it('requires a known discard reason, a duration and a rating', () => {
    expect(requireDiscardReason('hangup')).toBe('hangup');
    expect(() => requireDiscardReason('exploded')).toThrow(EngineError);
    expect(requireDuration(0)).toBe(0);
    expect(() => requireDuration(-1)).toThrow(EngineError);
    expect(requireRating(5)).toBe(5);
    expect(() => requireRating(6)).toThrow(EngineError);
    expect(() => requireRating(0)).toThrow(EngineError);
  });

  it('caps the signalling packets', () => {
    expect(requireBytes(encodeBase64(new Uint8Array(10)), 'data', 64)).toHaveLength(10);
    expect(() => requireBytes(encodeBase64(new Uint8Array(65)), 'data', 64)).toThrow(EngineError);
  });
});
