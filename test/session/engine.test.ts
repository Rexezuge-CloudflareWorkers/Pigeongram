import type { DatabaseSync } from 'node:sqlite';
import { describe, expect, it, vi } from 'vitest';
import { SessionEngine } from '../../worker/src/session/engine';
import { createNodeTransactionalStorage, openNodeDatabase } from './node-sql';

// The wasm-backed crypto provider cannot initialize under node: its wasm
// import is an instantiated namespace there, not the buffer `initSync`
// expects. Node tests exercise the engine and its storage path, which never
// touch the wasm primitives; wrangler bundles the real provider, and
// `wrangler deploy --dry-run` is the gate for that.
vi.mock('../../worker/src/session/mtproto/crypto', () => ({
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
 * `/api/updates` route, which these tests deliberately avoid.
 */
function createHarness(env: TestEnv = {}): Harness {
  const db = openNodeDatabase();
  const alarms: number[] = [];
  const sockets: FakeSocket[] = [];
  const transactional = createNodeTransactionalStorage(db);
  const storage = {
    sql: transactional.sql,
    transactionSync: transactional.transactionSync,
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
  };
  const engine = new SessionEngine(state as unknown as DurableObjectState, env as CloudflareEnv);
  return { engine, alarms, sockets, db };
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
  return new Request(`https://session-engine.internal/api/upload?${query}`, { method: 'POST', body, headers });
}

const FAKE_CREDENTIALS: TestEnv = {
  TELEGRAM_API_ID: '12345',
  TELEGRAM_API_HASH: '0123456789abcdef',
};

describe('SessionEngine (no credentials configured)', () => {
  it('reports the configuration error on /api/state instead of throwing', async () => {
    const { engine } = createHarness();
    const response = await engine.fetch(request('GET', '/api/state'));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      phase: 'error',
      authorized: false,
      me: null,
      error: expect.stringContaining('TELEGRAM_API_ID') as string,
    });
  });

  it('answers /api/stats with an empty wake log', async () => {
    const { engine } = createHarness();
    const response = await engine.fetch(request('GET', '/api/stats'));
    await expect(response.json()).resolves.toEqual({
      counters: { totalWakes: 0, failedWakes: 0, avgWakeMs: 0, updatesSeen: 0, lastWakeAt: null },
      days: [],
      databaseBytes: null,
    });
  });

  it('records a failed wake and re-arms when POST /api/wake cannot connect', async () => {
    const { engine, alarms } = createHarness();
    const response = await engine.fetch(request('POST', '/api/wake'));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ totalWakes: 1, failedWakes: 1 });
    expect(alarms.length).toBeGreaterThan(0);
  });

  it('runs a wake from alarm() and re-arms itself', async () => {
    const { engine, alarms } = createHarness();
    await engine.alarm();
    expect(alarms.length).toBeGreaterThan(0);
    const stats = (await (await engine.fetch(request('GET', '/api/stats'))).json()) as {
      counters: { totalWakes: number; failedWakes: number };
    };
    expect(stats.counters).toMatchObject({ totalWakes: 1, failedWakes: 1 });
  });

  it('puts the login flow into the error phase when QR sign-in cannot start', async () => {
    const { engine } = createHarness();
    const response = await engine.fetch(request('POST', '/api/login/qr'));
    await expect(response.json()).resolves.toMatchObject({
      phase: 'error',
      authorized: false,
      error: expect.stringContaining('TELEGRAM_API_ID') as string,
    });
  });

  it('puts the login flow into the error phase when the phone login cannot start', async () => {
    const { engine } = createHarness();
    const response = await engine.fetch(request('POST', '/api/login/phone', { phone: '+15551234567' }));
    await expect(response.json()).resolves.toMatchObject({
      phase: 'error',
      authorized: false,
      error: expect.stringContaining('TELEGRAM_API_ID') as string,
    });
  });

  it('preserves the login-flow reset when a cancel arrives', async () => {
    const { engine } = createHarness();
    // With no credentials the /api/state snapshot reports the config error, but
    // the cancel itself must still reset the flow (see login-flow.test.ts for
    // the state machine assertions).
    const response = await engine.fetch(request('POST', '/api/login/cancel'));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ authorized: false });
  });
});

describe('SessionEngine (request handling)', () => {
  it('404s unknown routes', async () => {
    const { engine } = createHarness();
    const response = await engine.fetch(request('GET', '/api/nope'));
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'Not found' });
  });

  it('400s a non-JSON body', async () => {
    const { engine } = createHarness();
    const response = await engine.fetch(
      new Request('https://session-engine.internal/api/login/password', {
        method: 'POST',
        body: 'not json',
      }),
    );
    expect(response.status).toBe(400);
  });

  it('409s a 2FA password with no pending login', async () => {
    const { engine } = createHarness();
    const response = await engine.fetch(request('POST', '/api/login/password', { password: 'hunter2' }));
    expect(response.status).toBe(409);
  });

  it('409s a login code with no pending phone login', async () => {
    const { engine } = createHarness();
    const response = await engine.fetch(request('POST', '/api/login/code', { code: '12345' }));
    expect(response.status).toBe(409);
  });

  it('400s a phone login with an unusable number', async () => {
    const { engine } = createHarness();
    const response = await engine.fetch(request('POST', '/api/login/phone', { phone: 'call me maybe' }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining('international') as string,
    });
  });

  it('400s media requests with unusable coordinates', async () => {
    // Missing messageId/chatId, and an avatar size the bridge does not serve.
    const paths = ['/api/file', '/api/file?chatId=1', '/api/avatar', '/api/avatar?chatId=1&size=huge'];
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
});

describe('SessionEngine (configured client)', () => {
  it('404s unknown RPC methods', async () => {
    const { engine } = createHarness(FAKE_CREDENTIALS);
    const response = await engine.fetch(request('POST', '/api/rpc', { method: 'doesNotExist' }));
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining('doesNotExist') as string,
    });
  });

  it('400s invalid RPC params before any network call', async () => {
    const { engine } = createHarness(FAKE_CREDENTIALS);
    const response = await engine.fetch(request('POST', '/api/rpc', { method: 'getHistory', params: {} }));
    expect(response.status).toBe(400);
  });

  it('400s a sendMessage with a malformed reply target before any network call', async () => {
    const { engine } = createHarness(FAKE_CREDENTIALS);
    const response = await engine.fetch(
      request('POST', '/api/rpc', { method: 'sendMessage', params: { chatId: 1, text: 'hi', replyTo: 0 } }),
    );
    expect(response.status).toBe(400);
  });

  it('400s an RPC without a method name', async () => {
    const { engine } = createHarness(FAKE_CREDENTIALS);
    const response = await engine.fetch(request('POST', '/api/rpc', { params: {} }));
    expect(response.status).toBe(400);
  });

  it('skips the network on a wake until the account is linked', async () => {
    const { engine, alarms } = createHarness(FAKE_CREDENTIALS);
    const response = await engine.fetch(request('POST', '/api/wake'));
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
