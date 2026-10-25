import { Long, PeersIndex, RawUpdateInfo } from '@mtcute/core';
import type { tl, User } from '@mtcute/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TelegramDriver } from '../../packages/backend-services/src/session/driver';
import { EngineError } from '../../packages/backend-services/src/session/errors';
import { createNodeTransactionalStorage, openNodeDatabase } from './node-sql';

/**
 * The driver is the seam between the lifecycle and mtcute. Its factory is
 * injected, so these tests run the real delegation, mapping and teardown
 * decisions over a stand-in bundle: no wasm, no network, no Telegram account.
 */

const media = vi.hoisted(() => ({
  streamMessageMedia: vi.fn(),
  readAvatar: vi.fn(),
  readAvatarVersion: vi.fn(),
}));

const upload = vi.hoisted(() => ({
  sendUploadedMedia: vi.fn(),
  sendUploadedMediaGroup: vi.fn(),
}));

vi.mock('../../packages/backend-services/src/session/media', () => media);
vi.mock('../../packages/backend-services/src/session/upload', () => upload);

const protocol: tl.TypePhoneCallProtocol = {
  _: 'phoneCallProtocol',
  udpP2p: true,
  udpReflector: true,
  minLayer: 65,
  maxLayer: 92,
  libraryVersions: ['13.0.0'],
};

const peers = PeersIndex.from({ users: [], chats: [] });

function update(phoneCall: Record<string, unknown>): RawUpdateInfo {
  return new RawUpdateInfo({ _: 'updatePhoneCall', phoneCall } as unknown as tl.TypeUpdate, peers);
}

const requested = (): RawUpdateInfo =>
  update({
    _: 'phoneCallRequested',
    id: Long.fromNumber(1000),
    accessHash: Long.fromNumber(555),
    date: 1,
    adminId: 1,
    participantId: 2,
    gAHash: new Uint8Array(32),
    protocol,
  });

interface FakeBase {
  onRawUpdate: { add(listener: (info: RawUpdateInfo) => void): () => void };
  onConnectionState: { add(handler: (state: string) => void): void; remove(handler: (state: string) => void): void };
  prepare: ReturnType<typeof vi.fn>;
  storage: { self: { fetch: ReturnType<typeof vi.fn> } };
  connect: ReturnType<typeof vi.fn>;
  stopUpdatesLoop: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
  startUpdatesLoop: ReturnType<typeof vi.fn>;
  isConnected: boolean;
  destroyed: boolean;
  updates: { pts: number | undefined; catchUp: ReturnType<typeof vi.fn> } | null;
}

interface Harness {
  driver: TelegramDriver;
  createBundle: ReturnType<typeof vi.fn>;
  base: FakeBase;
  client: {
    getMe: ReturnType<typeof vi.fn>;
    call: ReturnType<typeof vi.fn>;
    logOut: ReturnType<typeof vi.fn>;
  };
  rawListeners: Set<(info: RawUpdateInfo) => void>;
  stateHandlers: Set<(state: string) => void>;
}

function fakeBundle(options: { authorized?: boolean; destroyed?: boolean; pts?: number } = {}): Harness {
  const rawListeners = new Set<(info: RawUpdateInfo) => void>();
  const stateHandlers = new Set<(state: string) => void>();
  const base: FakeBase = {
    onRawUpdate: {
      add(listener): () => void {
        rawListeners.add(listener);
        return () => rawListeners.delete(listener);
      },
    },
    onConnectionState: {
      add(handler): void {
        stateHandlers.add(handler);
      },
      remove(handler): void {
        stateHandlers.delete(handler);
      },
    },
    prepare: vi.fn(async () => {}),
    storage: {
      self: {
        fetch: vi.fn(async () => (options.authorized === true ? { id: 1 } : null)),
      },
    },
    connect: vi.fn(async () => {}),
    stopUpdatesLoop: vi.fn(async () => {}),
    disconnect: vi.fn(async () => {}),
    destroy: vi.fn(async () => {}),
    startUpdatesLoop: vi.fn(async () => {}),
    isConnected: false,
    destroyed: options.destroyed === true,
    updates: {
      pts: options.pts,
      catchUp: vi.fn(),
    },
  };
  const client = {
    getMe: vi.fn(
      async () =>
        ({
          id: 1,
          firstName: 'Ada',
          lastName: null,
          username: 'ada',
          raw: { phone: '15551234567' },
        }) as unknown as User,
    ),
    call: vi.fn(async () => ({})),
    logOut: vi.fn(async () => {}),
  };
  const storage = createNodeTransactionalStorage(openNodeDatabase());
  const createBundle = vi.fn(() => ({ base, client, storage }) as never);
  const driver = new TelegramDriver({} as CloudflareEnv, storage, createBundle);
  return { driver, createBundle, base, client, rawListeners, stateHandlers };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('TelegramDriver', () => {
  it('builds its bundle lazily and reuses it', async () => {
    const harness = fakeBundle();
    expect(harness.createBundle).not.toHaveBeenCalled();

    await harness.driver.prepare();
    await harness.driver.prepare();

    expect(harness.createBundle).toHaveBeenCalledTimes(1);
    expect(harness.base.prepare).toHaveBeenCalledTimes(2);
  });

  it('reads the stored session as its authorization state', async () => {
    const signedOut = fakeBundle();
    await expect(signedOut.driver.isAuthorized()).resolves.toBe(false);

    const signedIn = fakeBundle({ authorized: true });
    await expect(signedIn.driver.isAuthorized()).resolves.toBe(true);
  });

  it('connects through the bundle', async () => {
    const harness = fakeBundle();

    await harness.driver.connect();

    expect(harness.base.connect).toHaveBeenCalledTimes(1);
  });

  it('keeps a bundle that had established an update state', async () => {
    const harness = fakeBundle({ pts: 42 });

    await harness.driver.connect();
    await harness.driver.disconnect();

    expect(harness.base.stopUpdatesLoop).toHaveBeenCalledTimes(1);
    expect(harness.base.disconnect).toHaveBeenCalledTimes(1);
    expect(harness.base.destroy).not.toHaveBeenCalled();

    // The next connect reuses it: its auth keys are already loaded.
    await harness.driver.connect();
    expect(harness.createBundle).toHaveBeenCalledTimes(1);
  });

  it('drops a bundle whose first catch-up never established a state', async () => {
    const harness = fakeBundle();

    await harness.driver.connect();
    await harness.driver.disconnect();

    expect(harness.base.destroy).toHaveBeenCalledTimes(1);

    // A fresh client is built from the durable auth keys.
    await harness.driver.connect();
    expect(harness.createBundle).toHaveBeenCalledTimes(2);
  });

  it('does not destroy an already-destroyed bundle', async () => {
    const harness = fakeBundle({ destroyed: true });
    await harness.driver.isAuthorized();

    await harness.driver.disconnect();

    expect(harness.base.stopUpdatesLoop).toHaveBeenCalledTimes(1);
    expect(harness.base.destroy).not.toHaveBeenCalled();
  });

  it('does nothing when disconnecting an unused driver', async () => {
    const harness = fakeBundle();

    await harness.driver.disconnect();

    expect(harness.createBundle).not.toHaveBeenCalled();
  });

  it('refuses to catch up on a dead connection', async () => {
    const harness = fakeBundle();

    await expect(harness.driver.catchUp()).rejects.toThrow('Not connected');
  });

  it('waits for the update manager to settle and unbinds its state listener', async () => {
    const harness = fakeBundle();
    harness.base.isConnected = true;
    harness.base.startUpdatesLoop.mockImplementation(async () => {
      for (const handler of harness.stateHandlers) handler('updating');
      for (const handler of harness.stateHandlers) handler('connected');
    });

    await harness.driver.catchUp(1000);

    expect(harness.base.startUpdatesLoop).toHaveBeenCalledTimes(1);
    expect(harness.base.updates?.catchUp).toHaveBeenCalledTimes(1);
    expect(harness.stateHandlers.size).toBe(0);
  });

  it('maps updates, tracks the active call and isolates a failing listener', async () => {
    const harness = fakeBundle();
    const seen: Array<string | null> = [];
    harness.driver.onEvent((event) => {
      seen.push(event?.type ?? null);
    });
    harness.driver.onEvent(() => {
      throw new Error('listener failure');
    });
    harness.driver.onEvent((event) => {
      if (event) seen.push(`second:${event.type}`);
    });

    await harness.driver.isAuthorized();
    for (const listener of harness.rawListeners) listener(requested());

    expect(seen).toEqual(['call', 'second:call']);
    expect(harness.driver.hasActiveCall).toBe(true);

    for (const listener of harness.rawListeners) {
      listener(update({ _: 'phoneCallEmpty', id: Long.fromNumber(1000) }));
    }
    expect(harness.driver.hasActiveCall).toBe(false);

    for (const listener of harness.rawListeners) {
      listener(
        update({
          _: 'phoneCallDiscarded',
          id: Long.fromNumber(1000),
          reason: { _: 'phoneCallDiscardReasonHangup' },
        }),
      );
    }
    expect(harness.driver.hasActiveCall).toBe(false);
  });

  it('reports a raw update the bridge has no event for as null', async () => {
    const harness = fakeBundle();
    const seen: Array<string | null> = [];
    harness.driver.onEvent((event) => seen.push(event?.type ?? null));

    await harness.driver.isAuthorized();
    const broken = new RawUpdateInfo({ _: 'updateNewMessage' } as unknown as tl.TypeUpdate, peers);
    for (const listener of harness.rawListeners) listener(broken);

    expect(seen).toEqual([null]);
  });

  it('unsubscribes an update listener', async () => {
    const harness = fakeBundle();
    const listener = vi.fn();
    const unsubscribe = harness.driver.onEvent(listener);

    await harness.driver.isAuthorized();
    unsubscribe();
    for (const rawListener of harness.rawListeners) rawListener(requested());

    expect(listener).not.toHaveBeenCalled();
  });

  it('routes the bridge RPC through the dispatch table', async () => {
    const harness = fakeBundle();

    const result = await harness.driver.rpc('getMe', {});

    expect(result).toEqual({
      me: { id: 1, firstName: 'Ada', lastName: null, username: 'ada', phone: '15551234567', photo: null },
    });
  });

  it('relays a signalling packet to a call the update stream announced', async () => {
    const harness = fakeBundle();
    await harness.driver.isAuthorized();
    for (const listener of harness.rawListeners) listener(requested());

    const data = new Uint8Array([1, 2, 3]);
    await harness.driver.sendCallSignaling('1000', data);

    expect(harness.client.call).toHaveBeenCalledWith({
      _: 'phone.sendSignalingData',
      peer: { _: 'inputPhoneCall', id: Long.fromNumber(1000), accessHash: Long.fromNumber(555) },
      data,
    });
  });

  it('refuses to relay signalling for a call it does not know', async () => {
    const harness = fakeBundle();

    await expect(harness.driver.sendCallSignaling('404', new Uint8Array())).rejects.toThrow(EngineError);
  });

  it('delegates media reads and uploads with the peer id attached', async () => {
    const harness = fakeBundle();
    const download = { stream: new ReadableStream(), mime: 'image/jpeg' };
    const avatar = { mime: 'image/jpeg', bytes: new Uint8Array([1]), version: 'v1' };
    const message = { id: 7 };
    const messages = [{ id: 7 }, { id: 8 }];
    media.streamMessageMedia.mockResolvedValue(download);
    media.readAvatar.mockResolvedValue(avatar);
    media.readAvatarVersion.mockResolvedValue('v1');
    upload.sendUploadedMedia.mockResolvedValue(message);
    upload.sendUploadedMediaGroup.mockResolvedValue(messages);

    await expect(harness.driver.streamMessageMedia(2, 3, { thumb: true })).resolves.toBe(download);
    await expect(harness.driver.readAvatar(2, 'small')).resolves.toBe(avatar);
    await expect(harness.driver.readAvatarVersion(2, 'big')).resolves.toBe('v1');
    const spec = { chatId: 2, kind: 'document' as const, size: 4 };
    const group = { chatId: 2, items: [{ kind: 'document' as const, size: 1 }] };
    const body = new ReadableStream<Uint8Array>();
    await expect(harness.driver.sendUpload(spec, body)).resolves.toBe(message);
    await expect(harness.driver.sendUploadGroup(group, body)).resolves.toBe(messages);

    expect(media.streamMessageMedia).toHaveBeenCalledWith(harness.client, 2, 3, { thumb: true });
    expect(media.readAvatar).toHaveBeenCalledWith(harness.client, 2, 'small');
    expect(media.readAvatarVersion).toHaveBeenCalledWith(harness.client, 2, 'big');
    expect(upload.sendUploadedMedia).toHaveBeenCalledWith(harness.client, spec, body, undefined);
    expect(upload.sendUploadedMediaGroup).toHaveBeenCalledWith(harness.client, group, body, undefined);
  });

  it('signs out on the server, clears the account state and drops the bundle', async () => {
    const harness = fakeBundle();
    await harness.driver.isAuthorized();
    for (const listener of harness.rawListeners) listener(requested());
    expect(harness.driver.hasActiveCall).toBe(true);

    await harness.driver.logout();

    expect(harness.client.logOut).toHaveBeenCalledTimes(1);
    expect(harness.base.destroy).toHaveBeenCalledTimes(1);
    expect(harness.driver.hasActiveCall).toBe(false);

    await harness.driver.connect();
    expect(harness.createBundle).toHaveBeenCalledTimes(2);
  });

  it('does nothing when signing out an unused driver', async () => {
    const harness = fakeBundle();

    await harness.driver.logout();

    expect(harness.createBundle).not.toHaveBeenCalled();
  });
});
