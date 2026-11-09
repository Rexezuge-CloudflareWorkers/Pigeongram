import { Long } from '@mtcute/core';
import type { tl } from '@mtcute/core';
import type { TelegramClient } from '@mtcute/core/client.js';
import { describe, expect, it, vi } from 'vitest';
import { encodeBase64 } from '../../packages/backend-services/src/session/base64';
import { callRpcMethods, sendCallSignaling } from '../../packages/backend-services/src/session/call-rpc';
import { CallRegistry } from '../../packages/backend-services/src/session/call-registry';
import { EngineError } from '../../packages/backend-services/src/session/errors';
import type { DispatchContext } from '../../packages/backend-services/src/session/rpc-methods';

/**
 * The calls surface of the bridge, one entry per method.
 *
 * The media never crosses this seam: the engine carries the handshake and the
 * signalling packets, and the access hash stays in its registry. These tests
 * pin the Telegram request each method sends and the registry bookkeeping the
 * engine does around it.
 */

const protocol: tl.TypePhoneCallProtocol = {
  _: 'phoneCallProtocol',
  udpP2p: true,
  udpReflector: true,
  minLayer: 65,
  maxLayer: 92,
  libraryVersions: ['13.0.0'],
};

function call(id: number, accessHash = 555): tl.RawPhoneCallWaiting {
  return {
    _: 'phoneCallWaiting',
    id: Long.fromNumber(id),
    accessHash: Long.fromNumber(accessHash),
    date: 1_700_000_000,
    adminId: 1,
    participantId: 2,
    protocol,
  };
}

function accepted(id: number): tl.RawPhoneCallAccepted {
  return {
    _: 'phoneCallAccepted',
    id: Long.fromNumber(id),
    accessHash: Long.fromNumber(555),
    date: 1_700_000_000,
    adminId: 1,
    participantId: 2,
    gB: new Uint8Array(256),
    protocol,
  };
}

function active(id: number): tl.TypePhoneCall {
  return {
    _: 'phoneCall',
    id: Long.fromNumber(id),
    accessHash: Long.fromNumber(555),
    date: 1_700_000_000,
    adminId: 1,
    participantId: 2,
    gAOrB: new Uint8Array(256),
    keyFingerprint: Long.fromNumber(7),
    protocol,
    connections: [],
    startDate: 1_700_000_001,
  };
}

interface Harness {
  context: DispatchContext;
  calls: CallRegistry;
  client: {
    call: ReturnType<typeof vi.fn>;
    resolveUser: ReturnType<typeof vi.fn>;
  };
  responses: Map<string, unknown>;
}

function harness(): Harness {
  const responses = new Map<string, unknown>();
  const client = {
    call: vi.fn(async (request: { _: string }) => responses.get(request._) ?? {}),
    resolveUser: vi.fn(async (chatId: number) => ({ _: 'inputUser', userId: chatId, accessHash: Long.fromNumber(1) })),
  };
  const calls = new CallRegistry();
  const context = {
    client: client as unknown as TelegramClient,
    calls,
    albums: {} as never,
    dispatch: vi.fn(),
  } as DispatchContext;
  return { context, calls, client, responses };
}

const gB = encodeBase64(new Uint8Array(256).fill(3));
const gA = encodeBase64(new Uint8Array(256).fill(4));
const gAHash = encodeBase64(new Uint8Array(32).fill(5));

describe('the call RPC methods', () => {
  it('reads the Diffie-Hellman prime and generator without the secret', async () => {
    const { context, client, responses } = harness();
    responses.set('messages.getDhConfig', { _: 'messages.dhConfig', g: 3, p: new Uint8Array([1, 2]), version: 9 });

    const result = await callRpcMethods.getCallDhConfig.run(context);

    expect(result).toEqual({ g: 3, p: encodeBase64(new Uint8Array([1, 2])), version: 9 });
    expect(client.call).toHaveBeenCalledWith({ _: 'messages.getDhConfig', version: 0, randomLength: 256 });
  });

  it('refuses a config that came back without a prime', async () => {
    const { context, responses } = harness();
    responses.set('messages.getDhConfig', { _: 'messages.dhConfigNotModified' });

    const failure = await callRpcMethods.getCallDhConfig.run(context).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(EngineError);
    expect(failure).toMatchObject({ status: 502 });
  });

  it('places a call and remembers the access hash it came back with', async () => {
    const { context, calls, client, responses } = harness();
    responses.set('phone.requestCall', { phoneCall: call(1000) });

    const result = await callRpcMethods.requestCall.run(context, { chatId: 2, gAHash, randomId: '7' });

    expect(result).toMatchObject({ call: { id: '1000', state: 'waiting' } });
    expect(calls.knows('1000')).toBe(true);
    expect(client.resolveUser).toHaveBeenCalledWith(2);
    expect(client.call).toHaveBeenCalledWith(
      expect.objectContaining({
        _: 'phone.requestCall',
        video: false,
        randomId: 7,
        gAHash: new Uint8Array(32).fill(5),
      }),
    );
  });

  it('acknowledges a received call by its id and the remembered hash', async () => {
    const { context, calls, client } = harness();
    calls.remember(call(1000));

    const result = await callRpcMethods.receivedCall.run(context, { callId: '1000' });

    expect(result).toEqual({});
    expect(client.call).toHaveBeenCalledWith({
      _: 'phone.receivedCall',
      peer: { _: 'inputPhoneCall', id: Long.fromNumber(1000), accessHash: Long.fromNumber(555) },
    });
  });

  it('accepts a call with the callee Diffie-Hellman value', async () => {
    const { context, calls, client, responses } = harness();
    calls.remember(call(1000));
    responses.set('phone.acceptCall', { phoneCall: accepted(2000) });

    const result = await callRpcMethods.acceptCall.run(context, { callId: '1000', gB });

    expect(result).toMatchObject({ call: { id: '2000', state: 'accepted' } });
    expect(calls.knows('2000')).toBe(true);
    expect(client.call).toHaveBeenCalledWith(
      expect.objectContaining({
        _: 'phone.acceptCall',
        gB: new Uint8Array(256).fill(3),
      }),
    );
  });

  it('confirms a call with the caller value and the key fingerprint', async () => {
    const { context, calls, client, responses } = harness();
    calls.remember(accepted(2000));
    responses.set('phone.confirmCall', { phoneCall: active(3000) });

    const result = await callRpcMethods.confirmCall.run(context, {
      callId: '2000',
      gA,
      keyFingerprint: '123456789',
    });

    expect(result).toMatchObject({ call: { id: '3000', state: 'active' } });
    expect(calls.knows('3000')).toBe(true);
    expect(client.call).toHaveBeenCalledWith(
      expect.objectContaining({
        _: 'phone.confirmCall',
        gA: new Uint8Array(256).fill(4),
        keyFingerprint: Long.fromString('123456789'),
      }),
    );
  });

  it('discards a call and forgets it', async () => {
    const { context, calls, client, responses } = harness();
    calls.remember(active(3000));
    responses.set('phone.discardCall', {});

    const result = await callRpcMethods.discardCall.run(context, {
      callId: '3000',
      reason: 'hangup',
      duration: 12,
      video: true,
    });

    expect(result).toEqual({});
    expect(calls.knows('3000')).toBe(false);
    expect(client.call).toHaveBeenCalledWith(
      expect.objectContaining({
        _: 'phone.discardCall',
        video: true,
        duration: 12,
        reason: { _: 'phoneCallDiscardReasonHangup' },
        connectionId: Long.ZERO,
      }),
    );
  });

  it('rates a call, defaulting the comment and forgetting the call', async () => {
    const { context, calls, client, responses } = harness();
    calls.remember(active(3000));
    responses.set('phone.setCallRating', {});

    await expect(callRpcMethods.rateCall.run(context, { callId: '3000', rating: 5 })).resolves.toEqual({});
    expect(client.call).toHaveBeenLastCalledWith(expect.objectContaining({ _: 'phone.setCallRating', rating: 5, comment: '' }));
    expect(calls.knows('3000')).toBe(false);

    calls.remember(active(4000));
    await callRpcMethods.rateCall.run(context, { callId: '4000', rating: 4, comment: 'Clear audio' });
    expect(client.call).toHaveBeenLastCalledWith(expect.objectContaining({ _: 'phone.setCallRating', rating: 4, comment: 'Clear audio' }));
  });

  it('relays a signalling packet to a known call', async () => {
    const { context, calls, client } = harness();
    calls.remember(call(1000));
    const data = new Uint8Array([1, 2, 3]);

    await sendCallSignaling(context.client, calls, '1000', data);

    expect(client.call).toHaveBeenCalledWith({
      _: 'phone.sendSignalingData',
      peer: { _: 'inputPhoneCall', id: Long.fromNumber(1000), accessHash: Long.fromNumber(555) },
      data,
    });
  });

  it('refuses to relay signalling for a call it has never seen', async () => {
    const { context, calls } = harness();

    await expect(sendCallSignaling(context.client, calls, '404', new Uint8Array())).rejects.toThrow(EngineError);
  });
});
