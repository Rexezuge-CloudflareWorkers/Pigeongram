import { MtUnsupportedError, ObfuscatedPacketCodec } from '@mtcute/core';
import type { ITelegramConnection } from '@mtcute/core';
import type { BasicDcOption } from '@mtcute/core/utils.js';
import { describe, expect, it, vi } from 'vitest';
import { WorkersWsTransport } from '../../packages/provider-clients/src/mtproto/transport';
import type { WebSocketConnect } from '../../packages/provider-clients/src/mtproto/transport';

/**
 * The transport's URL grammar. The network is the seam: the URL the engine
 * asks a browser to open is the one thing this class decides, so the fake
 * connect records it instead of dialling Telegram.
 */

function dc(overrides: Partial<BasicDcOption> = {}): BasicDcOption {
  return { id: 1, ipAddress: '149.154.175.50', port: 443, ...overrides };
}

function fakeConnect(): WebSocketConnect {
  return vi.fn(async () => ({}) as ITelegramConnection) as unknown as WebSocketConnect;
}

describe('WorkersWsTransport', () => {
  it('maps the first five DC ids onto their subdomains', () => {
    const connect = fakeConnect();
    const transport = new WorkersWsTransport({}, connect);
    const signal = new AbortController().signal;

    void transport.connect(dc({ id: 2 }), signal);

    expect(connect).toHaveBeenCalledWith(
      {
        url: 'wss://venus.web.telegram.org/apiws',
        implementation: WebSocket,
        protocols: 'binary',
      },
      signal,
    );
  });

  it('adds the test suffix when the DC is a test one', () => {
    const connect = fakeConnect();
    const transport = new WorkersWsTransport({}, connect);

    void transport.connect(dc({ id: 3, testMode: true }), new AbortController().signal);

    expect(connect).toHaveBeenCalledWith(expect.objectContaining({ url: 'wss://aurora.web.telegram.org/apiws_test' }), expect.anything());
  });

  it('honours a deployment-specific domain and subdomain map', () => {
    const connect = fakeConnect();
    const transport = new WorkersWsTransport({ baseDomain: 'example.test', subdomains: { 7: 'seven' } }, connect);

    void transport.connect(dc({ id: 7 }), new AbortController().signal);

    expect(connect).toHaveBeenCalledWith(expect.objectContaining({ url: 'wss://seven.example.test/apiws' }), expect.anything());
  });

  it('refuses a DC it has no subdomain for', () => {
    const transport = new WorkersWsTransport({}, fakeConnect());

    expect(() => transport.connect(dc({ id: 6 }), new AbortController().signal)).toThrow(MtUnsupportedError);
  });

  it('serves the obfuscated intermediate codec', () => {
    const codec = new WorkersWsTransport({}, fakeConnect()).packetCodec();

    expect(codec).toBeInstanceOf(ObfuscatedPacketCodec);
  });
});
