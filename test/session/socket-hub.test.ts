import { describe, expect, it, vi } from 'vitest';
import { MAX_SOCKET_FRAME_BYTES, UpdatesSocketHub } from '../../packages/backend-services/src/session/socket-hub';
import type { SocketHubHost } from '../../packages/backend-services/src/session/socket-hub';

/**
 * The updates socket's protocol.
 *
 * The hub is the engine's input boundary: a frame that is not one of its
 * three messages must cost nothing, and the last socket closing is what
 * releases the live session.
 */

interface FakeSocket {
  sent: string[];
  send(payload: string): void;
}

function socket(): FakeSocket {
  return {
    sent: [],
    send(payload: string) {
      this.sent.push(payload);
    },
  };
}

function hub(sockets: FakeSocket[] = []) {
  const host = {
    ensureLive: vi.fn(async () => {}),
    stopLive: vi.fn(async () => {}),
    sendCallSignaling: vi.fn(async () => {}),
  } satisfies SocketHubHost;
  const waitUntil = vi.fn();
  const state = {
    acceptWebSocket: vi.fn(),
    getWebSockets: () => sockets,
    waitUntil,
  };
  const instance = new UpdatesSocketHub(state as unknown as DurableObjectState, host);
  return { hub: instance, host, waitUntil, state };
}

function asSocket(value: FakeSocket): WebSocket {
  return value as unknown as WebSocket;
}

describe('UpdatesSocketHub', () => {
  it('answers ping without starting the live session', async () => {
    const { hub: instance, host } = hub();
    const client = socket();
    await instance.onMessage(asSocket(client), JSON.stringify({ type: 'ping' }));
    expect(client.sent).toEqual([JSON.stringify({ type: 'pong' })]);
    expect(host.ensureLive).not.toHaveBeenCalled();
  });

  it('answers hello, then joins the live session', async () => {
    const { hub: instance, host } = hub();
    const client = socket();
    await instance.onMessage(asSocket(client), JSON.stringify({ type: 'hello' }));
    expect(client.sent).toEqual([JSON.stringify({ type: 'ready' })]);
    expect(host.ensureLive).toHaveBeenCalledOnce();
  });

  it('ignores unknown, malformed and non-object frames', async () => {
    const { hub: instance, host } = hub();
    const client = socket();
    for (const frame of ['{}', 'not json', 'null', '"hello"', '{"type":"other"}']) {
      await instance.onMessage(asSocket(client), frame);
    }
    expect(client.sent).toHaveLength(0);
    expect(host.ensureLive).not.toHaveBeenCalled();
  });

  it('refuses a frame over the cap before parsing it', async () => {
    const { hub: instance, host } = hub();
    const client = socket();
    const oversized = `{"type":"hello","padding":"${'x'.repeat(MAX_SOCKET_FRAME_BYTES)}"}`;
    await instance.onMessage(asSocket(client), oversized);
    await instance.onMessage(asSocket(client), new TextEncoder().encode(oversized).buffer);
    expect(client.sent).toHaveLength(0);
    expect(host.ensureLive).not.toHaveBeenCalled();
  });

  it('relays a signalling packet outside the input gate', async () => {
    const { hub: instance, host, waitUntil } = hub();
    const data = Buffer.from([1, 2, 3]).toString('base64');
    await instance.onMessage(asSocket(socket()), JSON.stringify({ type: 'call_signaling', callId: '9', data }));
    expect(host.sendCallSignaling).toHaveBeenCalledWith('9', new Uint8Array([1, 2, 3]));
    expect(waitUntil).toHaveBeenCalledOnce();
  });

  it('ignores an empty, malformed or oversized signalling packet', async () => {
    const { hub: instance, host, waitUntil } = hub();
    for (const data of ['', '***', Buffer.alloc(70 * 1024).toString('base64')]) {
      await instance.onMessage(asSocket(socket()), JSON.stringify({ type: 'call_signaling', callId: '9', data }));
    }
    expect(host.sendCallSignaling).not.toHaveBeenCalled();
    expect(waitUntil).not.toHaveBeenCalled();
  });

  it('broadcasts to every socket and survives a closing one', () => {
    const healthy = socket();
    const broken: FakeSocket = {
      sent: [],
      send() {
        throw new Error('closing');
      },
    };
    const { hub: instance } = hub([healthy, broken]);
    instance.broadcast({ type: 'ready' });
    expect(healthy.sent).toEqual([JSON.stringify({ type: 'ready' })]);
  });

  it('releases the live session when the last socket closes', async () => {
    const first = socket();
    const second = socket();
    const sockets = [first, second];
    const { hub: instance, host } = hub(sockets);
    await instance.onClose(asSocket(first));
    expect(host.stopLive).not.toHaveBeenCalled();
    sockets.shift();
    await instance.onClose(asSocket(second));
    expect(host.stopLive).toHaveBeenCalledOnce();
  });
});
