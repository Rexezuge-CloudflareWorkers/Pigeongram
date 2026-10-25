import type { DatabaseSync } from 'node:sqlite';
import { describe, expect, it, vi } from 'vitest';
import type { MeDto } from '../../packages/backend-services/src/types';
import { AvatarCache } from '../../packages/backend-services/src/session/avatar-cache';
import { readEngineConfig } from '../../packages/backend-services/src/session/config';
import type { TelegramDriver } from '../../packages/backend-services/src/session/driver';
import { SessionEngine } from '../../packages/backend-services/src/session/engine';
import { errorResponse } from '../../packages/backend-services/src/session/http';
import { SessionLifecycle } from '../../packages/backend-services/src/session/lifecycle';
import type { EngineStore, StatsDto } from '../../packages/backend-services/src/session/stats';
import { createNodeSqlStorage, createNodeTransactionalStorage, openNodeDatabase } from './node-sql';

// The wasm-backed crypto provider cannot initialize under node: its wasm
// import is an instantiated namespace there, not the buffer `initSync`
// expects. Node tests exercise the engine and its storage path, which never
// touch the wasm primitives; wrangler bundles the real provider, and
// `wrangler deploy --dry-run` is the gate for that.
vi.mock('../../packages/provider-clients/src/mtproto/crypto', () => ({
  WorkerCryptoProvider: class {
    initialize(): void {}
    randomFill(buffer: Uint8Array): void {
      crypto.getRandomValues(buffer as Uint8Array<ArrayBuffer>);
    }
  },
}));

interface FakeSocket {
  sent: string[];
  send(payload: string): void;
  close(code?: number, reason?: string): void;
}

interface Harness {
  engine: SessionEngine;
  alarms: number[];
  sockets: FakeSocket[];
  db: DatabaseSync;
  /**
   * The storage preparations the engine ran before its first event.
   */
  prepared: number[];
  /**
   * The work the engine left running outside the input gate.
   */
  backgrounded: number[];
}

/**
 * The generated `CloudflareEnv` types vars as string literals; loosening just
 * the one var this suite overrides keeps the rest of the shape checked.
 */
type TestEnv = Omit<Partial<CloudflareEnv>, 'UPLOAD_MAX_BYTES'> & { UPLOAD_MAX_BYTES?: string };

/**
 * A `DurableObjectState` stand-in: SQLite from `node:sqlite`, an alarm spy, and
 * a socket list. The engine only ever touches these members, so the shape is
 * enough — `WebSocketPair` (the one global workerd owns) is only reached on the
 * `/user/updates` route, which these tests deliberately avoid.
 */
function createHarness(env: TestEnv = {}, seed?: (db: DatabaseSync) => void): Harness {
  const db = openNodeDatabase();
  seed?.(db);
  const alarms: number[] = [];
  const sockets: FakeSocket[] = [];
  const prepared: number[] = [];
  const backgrounded: number[] = [];
  const transactional = createNodeTransactionalStorage(db);
  const storage = {
    sql: transactional.sql,
    transactionSync: transactional.transactionSync,
    getAlarm: async (): Promise<number | null> => alarms.at(-1) ?? null,
    setAlarm: async (time: number | Date): Promise<void> => {
      alarms.push(typeof time === 'number' ? time : time.getTime());
    },
  };
  const state = {
    storage,
    acceptWebSocket: (socket: FakeSocket): void => {
      sockets.push(socket);
    },
    getWebSockets: (): FakeSocket[] => sockets,
    blockConcurrencyWhile: async <T>(callback: () => Promise<T>): Promise<T> => {
      prepared.push(1);
      return callback();
    },
    waitUntil: (promise: Promise<unknown>): void => {
      backgrounded.push(1);
      void promise;
    },
  };
  const engine = new SessionEngine(state as unknown as DurableObjectState, env as CloudflareEnv);
  return { engine, alarms, sockets, db, prepared, backgrounded };
}

function createSocket(): FakeSocket {
  return {
    sent: [],
    send(payload: string): void {
      this.sent.push(payload);
    },
    close(): void {},
  };
}

function request(method: string, path: string, body?: unknown): Request {
  return new Request(`https://session-engine.internal${path}`, {
    method,
    ...(body !== undefined && { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });
}

function uploadRequest(query: string, body: string, headers: Record<string, string> = {}): Request {
  return new Request(`https://session-engine.internal/user/upload?${query}`, { method: 'POST', body, headers });
}

function groupManifest(items: unknown[]): string {
  return Buffer.from(JSON.stringify(items)).toString('base64url');
}

function uploadGroupRequest(query: string, body: string, headers: Record<string, string> = {}): Request {
  return new Request(`https://session-engine.internal/user/upload-group?${query}`, { method: 'POST', body, headers });
}

const FAKE_CREDENTIALS: TestEnv = {
  TELEGRAM_API_ID: '12345',
  TELEGRAM_API_HASH: '0123456789abcdef',
};

describe('SessionEngine (no credentials configured)', () => {
  it('reports the configuration error on /user/state instead of throwing', async () => {
    const { engine } = createHarness();
    const response = await engine.fetch(request('GET', '/user/state'));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      phase: 'error',
      authorized: false,
      me: null,
      error: expect.stringContaining('TELEGRAM_API_ID') as string,
    });
  });

  it('answers /user/stats with an empty wake log', async () => {
    const { engine } = createHarness();
    const response = await engine.fetch(request('GET', '/user/stats'));
    await expect(response.json()).resolves.toEqual({
      counters: { totalWakes: 0, failedWakes: 0, avgWakeMs: 0, updatesSeen: 0, lastWakeAt: null },
      days: [],
      databaseBytes: null,
    });
  });

  it('records a failed wake and re-arms when POST /user/wake cannot connect', async () => {
    const { engine, alarms } = createHarness();
    const response = await engine.fetch(request('POST', '/user/wake'));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ totalWakes: 1, failedWakes: 1 });
    expect(alarms.length).toBeGreaterThan(0);
  });

  it('runs a wake from alarm() and re-arms itself', async () => {
    const { engine, alarms } = createHarness();
    await engine.alarm();
    expect(alarms.length).toBeGreaterThan(0);
    const stats = (await (await engine.fetch(request('GET', '/user/stats'))).json()) as {
      counters: { totalWakes: number; failedWakes: number };
    };
    expect(stats.counters).toMatchObject({ totalWakes: 1, failedWakes: 1 });
  });

  it('puts the login flow into the error phase when QR sign-in cannot start', async () => {
    const { engine } = createHarness();
    const response = await engine.fetch(request('POST', '/user/login/qr'));
    await expect(response.json()).resolves.toMatchObject({
      phase: 'error',
      authorized: false,
      error: expect.stringContaining('TELEGRAM_API_ID') as string,
    });
  });

  it('puts the login flow into the error phase when the phone login cannot start', async () => {
    const { engine } = createHarness();
    const response = await engine.fetch(request('POST', '/user/login/phone', { phone: '+15551234567' }));
    await expect(response.json()).resolves.toMatchObject({
      phase: 'error',
      authorized: false,
      error: expect.stringContaining('TELEGRAM_API_ID') as string,
    });
  });

  it('preserves the login-flow reset when a cancel arrives', async () => {
    const { engine } = createHarness();
    // With no credentials the /user/state snapshot reports the config error, but
    // the cancel itself must still reset the flow (see login-flow.test.ts for
    // the state machine assertions).
    const response = await engine.fetch(request('POST', '/user/login/cancel'));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ authorized: false });
  });
});

describe('SessionEngine (request handling)', () => {
  it('404s unknown routes', async () => {
    const { engine } = createHarness();
    const response = await engine.fetch(request('GET', '/user/nope'));
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'Not found', code: 'not_found' });
  });

  it('400s a non-JSON body', async () => {
    const { engine } = createHarness();
    const response = await engine.fetch(
      new Request('https://session-engine.internal/user/login/password', {
        method: 'POST',
        body: 'not json',
      }),
    );
    expect(response.status).toBe(400);
  });

  it('409s a 2FA password with no pending login', async () => {
    const { engine } = createHarness();
    const response = await engine.fetch(request('POST', '/user/login/password', { password: 'hunter2' }));
    expect(response.status).toBe(409);
  });

  it('409s a login code with no pending phone login', async () => {
    const { engine } = createHarness();
    const response = await engine.fetch(request('POST', '/user/login/code', { code: '12345' }));
    expect(response.status).toBe(409);
  });

  it('400s a phone login with an unusable number', async () => {
    const { engine } = createHarness();
    const response = await engine.fetch(request('POST', '/user/login/phone', { phone: 'call me maybe' }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining('international') as string,
    });
  });

  it('400s media requests with unusable coordinates', async () => {
    // Missing messageId/chatId, and an avatar size the bridge does not serve.
    const paths = ['/user/file', '/user/file?chatId=1', '/user/avatar', '/user/avatar?chatId=1&size=huge'];
    for (const path of paths) {
      const { engine } = createHarness();
      const response = await engine.fetch(request('GET', path));
      expect(response.status, path).toBe(400);
    }
  });

  it('validates upload requests before touching the network', async () => {
    // Every request below must fail validation; a valid one would need a
    // Telegram connection (the upload path is covered by the smoke test).
    const cases: Array<[string, string, number]> = [
      ['kind=photo&size=4', 'abcd', 400], // no chatId
      ['chatId=1&kind=sticker&size=4', 'abcd', 400], // unknown kind
      ['chatId=1&kind=document', 'abcd', 400], // no size
      ['chatId=1&kind=document&size=0', 'abcd', 400], // non-positive size
      ['chatId=1&kind=document&size=4&replyTo=0', 'abcd', 400], // non-positive reply target
      ['chatId=1&kind=document&size=4&replyTo=nope', 'abcd', 400], // non-numeric reply target
      ['chatId=1&kind=document&size=4&randomId=nope', 'abcd', 400], // malformed random id
      ['chatId=1&kind=document&size=4&randomId=0', 'abcd', 400], // non-positive random id
    ];
    for (const [query, body, status] of cases) {
      const { engine } = createHarness(FAKE_CREDENTIALS);
      const response = await engine.fetch(uploadRequest(query, body));
      expect(response.status, query).toBe(status);
    }
  });

  it('413s an upload above the configured cap', async () => {
    const { engine } = createHarness({ ...FAKE_CREDENTIALS, UPLOAD_MAX_BYTES: '10' });
    const response = await engine.fetch(uploadRequest('chatId=1&kind=document&size=11', '01234567890'));
    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining('limited') as string,
    });
  });

  it('400s an upload whose content-length disagrees with its size', async () => {
    const { engine } = createHarness(FAKE_CREDENTIALS);
    const response = await engine.fetch(uploadRequest('chatId=1&kind=document&size=5', '01234', { 'content-length': '4' }));
    expect(response.status).toBe(400);
  });

  it('validates album uploads before touching the network', async () => {
    const pair = groupManifest([
      { kind: 'document', size: 1 },
      { kind: 'document', size: 1 },
    ]);
    const cases: Array<[string, string, number]> = [
      ['chatId=1', 'xx', 400], // missing manifest
      ['chatId=1&manifest=!!!', 'xx', 400], // malformed base64url
      [`chatId=1&manifest=${groupManifest([{ kind: 'document', size: 1 }])}`, 'x', 400], // one item
      [`chatId=1&manifest=${groupManifest(Array.from({ length: 11 }, () => ({ kind: 'document', size: 1 })))}`, 'x'.repeat(11), 400], // 11 items
      [
        `chatId=1&manifest=${groupManifest([
          { kind: 'document', size: 1 },
          { kind: 'photo', size: 1 },
        ])}`,
        'xx',
        400,
      ], // mixed media
      [`chatId=1&manifest=${pair}&replyTo=0`, 'xx', 400], // unusable reply target
    ];
    for (const [query, body, status] of cases) {
      const { engine } = createHarness(FAKE_CREDENTIALS);
      const response = await engine.fetch(uploadGroupRequest(query, body));
      expect(response.status, query).toBe(status);
    }
  });

  it('413s an album above the configured cap', async () => {
    const { engine } = createHarness({ ...FAKE_CREDENTIALS, UPLOAD_MAX_BYTES: '10' });
    const manifest = groupManifest([
      { kind: 'document', size: 6 },
      { kind: 'document', size: 6 },
    ]);
    const response = await engine.fetch(uploadGroupRequest(`chatId=1&manifest=${manifest}`, '012345678901'));
    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining('limited') as string,
    });
  });

  it('400s an album whose content-length disagrees with the manifest total', async () => {
    const { engine } = createHarness(FAKE_CREDENTIALS);
    const manifest = groupManifest([
      { kind: 'document', size: 5 },
      { kind: 'document', size: 5 },
    ]);
    const response = await engine.fetch(uploadGroupRequest(`chatId=1&manifest=${manifest}`, '0123456789', { 'content-length': '9' }));
    expect(response.status).toBe(400);
  });
});

describe('SessionEngine (configured client)', () => {
  it('404s unknown RPC methods', async () => {
    const { engine } = createHarness(FAKE_CREDENTIALS);
    const response = await engine.fetch(request('POST', '/user/rpc', { method: 'doesNotExist' }));
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining('doesNotExist') as string,
    });
  });

  it('400s invalid RPC params before any network call', async () => {
    const { engine } = createHarness(FAKE_CREDENTIALS);
    const response = await engine.fetch(request('POST', '/user/rpc', { method: 'getHistory', params: {} }));
    expect(response.status).toBe(400);
  });

  it('400s params that are not an object', async () => {
    const { engine } = createHarness(FAKE_CREDENTIALS);
    const response = await engine.fetch(request('POST', '/user/rpc', { method: 'getMe', params: 'garbage' }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining('object') as string });
  });

  it('completes a logout when the write budget refuses the snapshot delete', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { engine, alarms } = createHarness({}, (db) => {
      db.exec('create table if not exists engine_meta (key text primary key, value text not null)');
      db.exec("insert into engine_meta (key, value) values ('me', '{}')");
      db.exec("create trigger meta_quota before delete on engine_meta begin select raise(abort, 'storage write quota'); end");
    });

    const response = await engine.fetch(request('POST', '/user/logout'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(warn).toHaveBeenCalled();
    expect(alarms.length).toBeGreaterThan(0);
    warn.mockRestore();
  });

  it('survives a corrupt stored profile snapshot', async () => {
    const { engine } = createHarness(FAKE_CREDENTIALS, (db) => {
      db.exec('create table if not exists engine_meta (key text primary key, value text not null)');
      db.exec("insert into engine_meta (key, value) values ('me', '{not json')");
    });
    const response = await engine.fetch(request('GET', '/user/state'));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ authorized: false, me: null });
  });

  it('400s a sendMessage with a malformed reply target before any network call', async () => {
    const { engine } = createHarness(FAKE_CREDENTIALS);
    const response = await engine.fetch(
      request('POST', '/user/rpc', { method: 'sendMessage', params: { chatId: 1, text: 'hi', replyTo: 0 } }),
    );
    expect(response.status).toBe(400);
  });

  it('400s a sendMessage with a malformed random id before any network call', async () => {
    const { engine } = createHarness(FAKE_CREDENTIALS);
    const response = await engine.fetch(
      request('POST', '/user/rpc', { method: 'sendMessage', params: { chatId: 1, text: 'hi', randomId: 'nope' } }),
    );
    expect(response.status).toBe(400);
  });

  it('400s an RPC without a method name', async () => {
    const { engine } = createHarness(FAKE_CREDENTIALS);
    const response = await engine.fetch(request('POST', '/user/rpc', { params: {} }));
    expect(response.status).toBe(400);
  });

  it('skips the network on a wake until the account is linked', async () => {
    const { engine, alarms } = createHarness(FAKE_CREDENTIALS);
    const response = await engine.fetch(request('POST', '/user/wake'));
    expect(response.status).toBe(200);
    // Configured but unsigned-in: the wake is a no-op success, not a failure,
    // because there is nothing to replay before the QR login completes.
    await expect(response.json()).resolves.toMatchObject({ totalWakes: 1, failedWakes: 0 });
    expect(alarms.length).toBeGreaterThan(0);
  });
});

describe('SessionEngine (updates socket protocol)', () => {
  it('answers ping with pong', async () => {
    const { engine, sockets } = createHarness();
    const socket = createSocket();
    sockets.push(socket);
    await engine.webSocketMessage(socket as unknown as WebSocket, JSON.stringify({ type: 'ping' }));
    expect(socket.sent).toEqual([JSON.stringify({ type: 'pong' })]);
  });

  it('ignores malformed socket frames', async () => {
    const { engine, sockets } = createHarness();
    const socket = createSocket();
    sockets.push(socket);
    await engine.webSocketMessage(socket as unknown as WebSocket, 'not json');
    expect(socket.sent).toEqual([]);
  });

  it('replies ready, then broadcasts the failure when going live is impossible', async () => {
    const { engine, sockets } = createHarness();
    const socket = createSocket();
    sockets.push(socket);
    await engine.webSocketMessage(socket as unknown as WebSocket, JSON.stringify({ type: 'hello' }));
    const messages = socket.sent.map((line) => JSON.parse(line) as { type: string });
    expect(messages[0]).toEqual({ type: 'ready' });
    expect(messages[1]).toMatchObject({ type: 'error' });
  });

  it('refuses to go live before sign-in without touching the network', async () => {
    const { engine, sockets, alarms } = createHarness(FAKE_CREDENTIALS);
    const socket = createSocket();
    sockets.push(socket);
    await engine.webSocketMessage(socket as unknown as WebSocket, JSON.stringify({ type: 'hello' }));
    expect(socket.sent.map((line) => JSON.parse(line) as { type: string; message?: string })).toEqual([
      { type: 'ready' },
      { type: 'error', message: 'Not signed in' },
    ]);
    // No arm means the connect path was never entered: an anonymous client has
    // no DC, and mtcute's updates loop would spin forever against one.
    expect(alarms).toEqual([]);
  });

  it('disconnects and re-arms when the last socket closes', async () => {
    const { engine, sockets, alarms } = createHarness();
    const socket = createSocket();
    sockets.push(socket);
    await engine.webSocketClose(socket as unknown as WebSocket);
    expect(alarms.length).toBe(1);
    expect(sockets).toEqual([socket]);
  });
});

describe('SessionEngine (cold start)', () => {
  it('prepares the storage before the first event is dispatched', () => {
    // The Durable Object hands out one event at a time, so the migrations the
    // storage needs are paid once, while the object is still empty.
    const { prepared } = createHarness();
    expect(prepared.length).toBe(1);
  });
});

describe('SessionEngine (alarm budget)', () => {
  it('arms once for repeated requests and repairs a missing alarm', async () => {
    const { engine, alarms } = createHarness();
    await engine.fetch(request('GET', '/user/state'));
    expect(alarms).toHaveLength(1);

    // A second request must not schedule the same cadence again: `setAlarm`
    // is a row write on the Free plan.
    await engine.fetch(request('GET', '/user/state'));
    expect(alarms).toHaveLength(1);

    // The runtime consumes the alarm before invoking alarm(); an alarm that a
    // rejected write never scheduled is the state this has to repair.
    alarms.length = 0;
    await engine.fetch(request('GET', '/user/state'));
    expect(alarms).toHaveLength(1);
  });
});

describe('SessionEngine (storage write budget)', () => {
  it('maps the Free-plan write quota to a typed 503', async () => {
    const response = errorResponse(new Error('Exceeded allowed rows written in Durable Objects free tier'));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      code: 'storage_write_quota',
      error: expect.stringContaining('00:00 UTC'),
    });
  });

  it('keeps a wake alive when the wake log cannot be written', async () => {
    const counters = { totalWakes: 0, failedWakes: 0, avgWakeMs: 0, updatesSeen: 0, lastWakeAt: null };
    const lifecycle = new SessionLifecycle({
      driver: { isAuthorized: () => Promise.resolve(false) },
      hub: { broadcast: () => {} },
      login: { running: false },
      state: {
        getWebSockets: (): never[] => [],
        storage: { getAlarm: () => Promise.resolve(null), setAlarm: () => Promise.resolve() },
      },
      store: {
        recordWake: (): never => {
          throw new Error('Exceeded allowed rows written in Durable Objects free tier');
        },
        counters: () => counters,
      },
      config: readEngineConfig({}),
    } as unknown as ConstructorParameters<typeof SessionLifecycle>[0]);

    await expect(lifecycle.runWake('manual')).resolves.toEqual(counters);
  });
});

const ME: MeDto = {
  id: 1,
  firstName: 'Ada',
  lastName: null,
  username: 'ada',
  phone: null,
  photo: null,
};

/**
 * The engine over injected collaborators.
 *
 * `EngineDeps` is the seam the route table needed: every route can be driven
 * to a decision without wasm, a Telegram connection or a real account, and the
 * quota failures can be produced by the store instead of by exhausting a
 * budget.
 */
function createSeamedHarness(options: { authorized?: boolean; me?: MeDto; store?: ReturnType<typeof fakeStore> } = {}) {
  const alarms: number[] = [];
  const driver = fakeDriver(options);
  const store = options.store ?? fakeStore();
  const avatars = new AvatarCache(createNodeSqlStorage(openNodeDatabase()));
  const state = {
    storage: {
      sql: createNodeSqlStorage(openNodeDatabase()),
      transactionSync: <T>(closure: () => T): T => closure(),
      getAlarm: async (): Promise<number | null> => alarms.at(-1) ?? null,
      setAlarm: async (time: number | Date): Promise<void> => {
        alarms.push(typeof time === 'number' ? time : time.getTime());
      },
    },
    acceptWebSocket: (): void => {},
    getWebSockets: (): never[] => [],
    blockConcurrencyWhile: async <T>(callback: () => Promise<T>): Promise<T> => callback(),
    waitUntil: (): void => {},
  };
  const engine = new SessionEngine(state as unknown as DurableObjectState, {} as CloudflareEnv, {
    driver: driver as unknown as TelegramDriver,
    store: store as unknown as EngineStore,
    avatars,
  });
  return { engine, driver, store, avatars, alarms };
}

function fakeDriver(options: { authorized?: boolean; me?: MeDto } = {}) {
  return {
    onEvent: vi.fn(() => () => {}),
    prepare: vi.fn(async () => {}),
    isAuthorized: vi.fn(async () => options.authorized === true),
    connect: vi.fn(async () => {}),
    disconnect: vi.fn(async () => {}),
    catchUp: vi.fn(async () => {}),
    rpc: vi.fn(async () => ({ echoed: true })),
    sendCallSignaling: vi.fn(async () => {}),
    streamMessageMedia: vi.fn(async () => ({
      stream: new ReadableStream<Uint8Array>({
        start(controller): void {
          controller.enqueue(new TextEncoder().encode('data'));
          controller.close();
        },
      }),
      mime: 'image/jpeg',
      size: 4,
      length: 4,
      status: 200 as const,
      contentRange: null,
    })),
    readAvatar: vi.fn(async () => ({ mime: 'image/jpeg', bytes: new Uint8Array([1, 2]), version: 'v1' })),
    readAvatarVersion: vi.fn(async (): Promise<string | null> => null),
    sendUpload: vi.fn(async () => ({ id: 7 })),
    sendUploadGroup: vi.fn(async () => [{ id: 7 }, { id: 8 }]),
    logout: vi.fn(async () => {}),
    signInQr: vi.fn(async (callbacks: { onUrl(url: string, expiresMs: number): void }) => {
      callbacks.onUrl('https://qr.example/token', Date.now() + 1000);
      return options.me ?? ME;
    }),
    signInPhone: vi.fn(),
    hasActiveCall: false,
  };
}

function fakeStore() {
  const counters = { totalWakes: 0, failedWakes: 0, avgWakeMs: 0, updatesSeen: 0, lastWakeAt: null };
  return {
    readMeta: vi.fn((): string | null => null),
    writeMeta: vi.fn(),
    recordWake: vi.fn(),
    counters: vi.fn(() => counters),
    stats: vi.fn((): StatsDto => ({ counters, days: [], databaseBytes: null })),
  };
}

describe('SessionEngine (route table over the seams)', () => {
  it('serves the state from the injected store', async () => {
    const { engine, driver } = createSeamedHarness({ authorized: true });

    const response = await engine.fetch(request('GET', '/user/state'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ phase: 'authorized', authorized: true, me: null });
    expect(driver.isAuthorized).toHaveBeenCalledTimes(1);
  });

  it('delegates the RPC route and arms the wake cadence', async () => {
    const { engine, driver, alarms } = createSeamedHarness();

    const response = await engine.fetch(request('POST', '/user/rpc', { method: 'getMe', params: { chatId: 2 } }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ echoed: true });
    expect(driver.rpc).toHaveBeenCalledWith('getMe', { chatId: 2 });
    expect(alarms.length).toBeGreaterThan(0);
  });

  it('serves the stats route from the injected store', async () => {
    const { engine, store } = createSeamedHarness();

    const response = await engine.fetch(request('GET', '/user/stats?days=3'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ counters: { totalWakes: 0 } });
    expect(store.stats).toHaveBeenCalledWith(3);
  });

  it('runs a wake through the injected driver', async () => {
    const { engine, driver } = createSeamedHarness();

    const response = await engine.fetch(request('POST', '/user/wake'));

    expect(response.status).toBe(200);
    expect(driver.isAuthorized).toHaveBeenCalledTimes(1);
  });

  it('streams a ranged file', async () => {
    const { engine, driver } = createSeamedHarness();
    const ranged = new Request('https://session-engine.internal/user/file?chatId=2&messageId=3', {
      headers: { range: 'bytes=0-3' },
    });

    const response = await engine.fetch(ranged);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/jpeg');
    expect(await response.text()).toBe('data');
    expect(driver.streamMessageMedia).toHaveBeenCalledWith(2, 3, { range: { start: 0, end: 3 } });
  });

  it('serves an avatar and then answers the repeat from the cache', async () => {
    const { engine, driver } = createSeamedHarness();

    const first = await engine.fetch(request('GET', '/user/avatar?chatId=2&size=small'));
    expect(new Uint8Array(await first.arrayBuffer())).toEqual(new Uint8Array([1, 2]));
    expect(driver.readAvatar).toHaveBeenCalledTimes(1);

    driver.readAvatarVersion.mockResolvedValue('v1');
    const second = await engine.fetch(request('GET', '/user/avatar?chatId=2&size=small'));

    expect(new Uint8Array(await second.arrayBuffer())).toEqual(new Uint8Array([1, 2]));
    expect(driver.readAvatar).toHaveBeenCalledTimes(1);
  });

  it('accepts a single upload through the injected driver', async () => {
    const { engine, driver } = createSeamedHarness();

    const response = await engine.fetch(uploadRequest('chatId=2&kind=document&size=4', 'abcd'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ message: { id: 7 } });
    expect(driver.sendUpload).toHaveBeenCalledTimes(1);
  });

  it('accepts an album upload through the injected driver', async () => {
    const { engine, driver } = createSeamedHarness();
    const manifest = groupManifest([
      { kind: 'document', size: 1 },
      { kind: 'document', size: 1 },
    ]);

    const response = await engine.fetch(uploadGroupRequest(`chatId=2&manifest=${manifest}`, 'xx'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ messages: [{ id: 7 }, { id: 8 }] });
    expect(driver.sendUploadGroup).toHaveBeenCalledTimes(1);
  });

  it('405s a known path with the wrong verb, and 404s an unknown path', async () => {
    const { engine } = createSeamedHarness();
    const wrongVerbs: Array<[string, string]> = [
      ['GET', '/user/rpc'],
      ['POST', '/user/state'],
      ['DELETE', '/user/updates'],
      ['GET', '/user/logout'],
    ];
    for (const [method, path] of wrongVerbs) {
      const response = await engine.fetch(request(method, path));
      expect(response.status, `${method} ${path}`).toBe(405);
      await expect(response.json()).resolves.toEqual({ error: 'Method not allowed', code: 'validation' });
    }

    const missing = await engine.fetch(request('GET', '/user/nope'));
    expect(missing.status).toBe(404);
    await expect(missing.json()).resolves.toEqual({ error: 'Not found', code: 'not_found' });
  });

  it('completes a QR login when the write budget refuses the snapshot', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = fakeStore();
    store.writeMeta.mockImplementation(() => {
      throw new Error('Exceeded allowed rows written in Durable Objects free tier');
    });
    const { engine, driver } = createSeamedHarness({ authorized: true, me: ME, store });

    const response = await engine.fetch(request('POST', '/user/login/qr'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ phase: 'authorized', authorized: true, me: ME });
    expect(driver.signInQr).toHaveBeenCalledTimes(1);
    expect(store.writeMeta).toHaveBeenCalledWith('me', JSON.stringify(ME));
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('completes a logout when the write budget refuses the snapshot delete', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = fakeStore();
    store.writeMeta.mockImplementation(() => {
      throw new Error('Exceeded allowed rows written in Durable Objects free tier');
    });
    const { engine, driver, alarms } = createSeamedHarness({ store });

    const response = await engine.fetch(request('POST', '/user/logout'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(driver.logout).toHaveBeenCalledTimes(1);
    expect(store.writeMeta).toHaveBeenCalledWith('me', null);
    expect(alarms.length).toBeGreaterThan(0);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
