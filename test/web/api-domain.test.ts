import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchStickerLibrary, fetchStickerSet, installStickerSet, sendSticker, stickerUrl } from '../../apps/web/src/api/stickers';
import { acceptCall, confirmCall, discardCall, fetchCallDhConfig, receivedCall, requestCall } from '../../apps/web/src/calls/api';

/**
The domain half of the bridge client, exercised against a stubbed `fetch`.

The component tests replace `src/api` wholesale, so these shapes — the method
name and the exact parameters on the wire — were the one part of the contract
no test touched. They are what the engine validates, so they belong here.
*/

function installFetch(body: unknown): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(() => Response.json(body, { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function sent(fetchMock: ReturnType<typeof vi.fn>): { method: string; params?: Record<string, unknown> } {
  const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  return JSON.parse(init.body as string) as { method: string; params?: Record<string, unknown> };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('sticker bridge client', () => {
  it('reads a library and unwraps a pack', async () => {
    const libraryFetch = installFetch({ recents: [], sets: [] });
    await expect(fetchStickerLibrary()).resolves.toEqual({ recents: [], sets: [] });
    expect(sent(libraryFetch)).toEqual({ method: 'getStickerLibrary' });

    const setFetch = installFetch({ set: { id: '1', accessHash: '2', shortName: 'p', title: 'Pack', stickers: [] } });
    await expect(fetchStickerSet({ shortName: 'p' })).resolves.toMatchObject({ shortName: 'p' });
    expect(sent(setFetch)).toEqual({ method: 'getStickerSet', params: { shortName: 'p' } });
  });

  it('installs a link and sends by the engine-minted id', async () => {
    const fetchMock = installFetch({ set: { id: '3' } });
    await expect(installStickerSet('pack')).resolves.toEqual({ id: '3' });
    expect(sent(fetchMock)).toEqual({ method: 'installStickerSet', params: { shortName: 'pack' } });

    const sendFetch = installFetch({ message: { id: 9 } });
    await expect(
      sendSticker(5, '12345', {
        replyTo: 7,
        randomId: 'rnd',
        set: { id: '1', accessHash: '2' },
      }),
    ).resolves.toEqual({ message: { id: 9 } });
    expect(sent(sendFetch)).toEqual({
      method: 'sendSticker',
      params: { chatId: 5, documentId: '12345', replyTo: 7, randomId: 'rnd', set: { id: '1', accessHash: '2' } },
    });
  });

  it('builds the registry-addressed sticker URL with a preview flag', () => {
    expect(stickerUrl('12345', 'v1')).toBe('/user/sticker?documentId=12345&v=v1&thumb=1');
    expect(stickerUrl('12345', 'v1', false)).toBe('/user/sticker?documentId=12345&v=v1');
  });
});

describe('call bridge client', () => {
  it('reads only the public exchange parameters', async () => {
    const fetchMock = installFetch({ g: 3, p: 'AQID', version: 0 });
    await expect(fetchCallDhConfig()).resolves.toEqual({ g: 3, p: 'AQID', version: 0 });
    expect(sent(fetchMock)).toEqual({ method: 'getCallDhConfig' });
  });

  it('sends opaque call bytes without a shared key', async () => {
    const cases: Array<[() => Promise<unknown>, string, Record<string, unknown>]> = [
      [() => requestCall({ chatId: 1, gAHash: 'hash', randomId: 'r' }), 'requestCall', { chatId: 1, gAHash: 'hash', randomId: 'r' }],
      [() => receivedCall('42'), 'receivedCall', { callId: '42' }],
      [() => acceptCall({ callId: '42', gB: 'bytes' }), 'acceptCall', { callId: '42', gB: 'bytes' }],
      [
        () => confirmCall({ callId: '42', gA: 'bytes', keyFingerprint: 'fp' }),
        'confirmCall',
        { callId: '42', gA: 'bytes', keyFingerprint: 'fp' },
      ],
      [() => discardCall({ callId: '42', reason: 'hangup', duration: 3 }), 'discardCall', { callId: '42', reason: 'hangup', duration: 3 }],
    ];
    for (const [call, method, params] of cases) {
      const fetchMock = installFetch({ call: { id: '42' } });
      await call();
      expect(sent(fetchMock)).toEqual({ method, params });
    }
  });
});
