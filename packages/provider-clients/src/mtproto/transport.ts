import { connectWs } from '@fuman/net';
import type { WebSocketEndpoint } from '@fuman/net';
import { IntermediatePacketCodec, MtUnsupportedError, ObfuscatedPacketCodec } from '@mtcute/core';
import type { IPacketCodec, ITelegramConnection, TelegramTransport } from '@mtcute/core';
import type { BasicDcOption } from '@mtcute/core/utils.js';

/**
DC id → subdomain, the map every Telegram web client uses.
*/
const DEFAULT_SUBDOMAINS: Record<number, string> = {
  1: 'pluto',
  2: 'venus',
  3: 'aurora',
  4: 'vesta',
  5: 'flora',
};

/**
 * Opens the WebSocket connection. Injectable so the URL building and the
 * unsupported-DC refusal can be tested without a network.
 */
export type WebSocketConnect = (endpoint: WebSocketEndpoint, signal?: AbortSignal) => Promise<ITelegramConnection>;

/**
 * MTProto over WSS (`wss://{dc}.web.telegram.org/apiws`), adapted from
 * `@mtcute/web`'s `WebSocketTransport` (mtcute 0.32.5, MIT licence).
 *
 * The framing is obfuscated2 over the intermediate codec — the same one the
 * official web clients speak. `connectWs` from `@fuman/net` wraps workerd's
 * global `WebSocket` as an `IConnection`; the class lives here rather than
 * being imported from `@mtcute/web` because that package does not export the
 * subpath and pulls browser storage into the bundle when imported as a whole.
 */
export class WorkersWsTransport implements TelegramTransport {
  constructor(
    private readonly options: {
      baseDomain?: string;
      subdomains?: Record<number, string>;
    } = {},
    private readonly open: WebSocketConnect = connectWs,
  ) {}

  connect(dc: BasicDcOption, abortSignal: AbortSignal): Promise<ITelegramConnection> {
    const subdomains = this.options.subdomains ?? DEFAULT_SUBDOMAINS;
    const subdomain = subdomains[dc.id];
    if (!subdomain) {
      throw new MtUnsupportedError(`No WebSocket subdomain known for DC ${dc.id}`);
    }
    const baseDomain = this.options.baseDomain ?? 'web.telegram.org';
    const url = `wss://${subdomain}.${baseDomain}/apiws${dc.testMode ? '_test' : ''}`;
    return this.open({ url, implementation: WebSocket, protocols: 'binary' }, abortSignal);
  }

  packetCodec(): IPacketCodec {
    return new ObfuscatedPacketCodec(new IntermediatePacketCodec());
  }
}
