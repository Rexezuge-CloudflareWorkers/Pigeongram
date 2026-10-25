import type { ClientSocketMessage, ServerSocketMessage } from '../types';
import { decodeBase64 } from './base64';
import { MAX_SIGNALING_BYTES } from './call-params';
import { log } from './log';

/**
 * The largest client frame the hub will parse. Signalling packets are capped
 * much lower; this is the outer guard for a frame that claims to be one.
 */
export const MAX_SOCKET_FRAME_BYTES = 128 * 1024;

/**
 * What the hub needs from the engine: the live-session lifecycle and the
 * call relay.
 */
export interface SocketHubHost {
  /**
   * Connects (or joins) the live session; called when a client says hello.
   */
  ensureLive(): Promise<void>;
  /**
   * Releases the live session once the last socket detaches.
   */
  stopLive(): Promise<void>;
  /**
   * Relays one signalling packet to the other peer of a call.
   */
  sendCallSignaling(callId: string, data: Uint8Array): Promise<void>;
}

/**
 * The `/user/updates` fan-out.
 *
 * Sockets are accepted with the hibernation API, so the engine is woken by
 * `webSocketMessage`/`webSocketClose` rather than by live listeners. The
 * protocol is intentionally tiny: `hello` (client attached, go live) and
 * `ping` (keepalive), answered by `ready` and `pong`; engine events ride on
 * `update`, and state failures are broadcast as `error`.
 *
 * The one addition is `call_signaling`: the client sends an opaque packet on
 * its way to the other peer, and the engine relays it. It rides the socket
 * rather than `POST /user/rpc` because a WebSocket message is not a Worker
 * request — the packets of a call setup would otherwise spend the Free
 * plan's daily request allowance, and the round trip would be longer.
 */
export class UpdatesSocketHub {
  constructor(
    private readonly state: DurableObjectState,
    private readonly host: SocketHubHost,
  ) {}

  /**
   * Accepts a socket. The live session is started by `hello`, not by the accept
   * itself: a socket that never speaks the protocol must not open a connection
   * (and must not consume a broadcast of the engine's answer).
   */
  accept(): Response {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    this.state.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  async onMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message === 'string') {
      // A UTF-16 code unit is at least one byte of UTF-8, so a string under
      // the cap cannot exceed it; a string over it is refused before parsing.
      if (message.length > MAX_SOCKET_FRAME_BYTES) return;
    } else if (message.byteLength > MAX_SOCKET_FRAME_BYTES) {
      return;
    }
    const text = typeof message === 'string' ? message : new TextDecoder().decode(message);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return;
    }
    if (typeof parsed !== 'object' || parsed === null) return;
    const frame = parsed as ClientSocketMessage;
    if (frame.type === 'ping') {
      socket.send(JSON.stringify({ type: 'pong' } satisfies ServerSocketMessage));
      return;
    }
    if (frame.type === 'call_signaling') {
      this.relaySignaling(frame.callId, frame.data);
      return;
    }
    if (frame.type !== 'hello') {
      return;
    }

    socket.send(JSON.stringify({ type: 'ready' } satisfies ServerSocketMessage));
    await this.host.ensureLive();
  }

  async onClose(socket: WebSocket): Promise<void> {
    const remaining = this.state.getWebSockets().filter((open) => open !== socket).length;
    if (remaining === 0) await this.host.stopLive();
  }

  broadcast(message: ServerSocketMessage): void {
    const payload = JSON.stringify(message);
    for (const socket of this.state.getWebSockets()) {
      try {
        socket.send(payload);
      } catch {
        // The socket is closing; the runtime reports it via webSocketClose.
      }
    }
  }

  /**
   * Hands a signalling packet to Telegram, outside the input gate.
   *
   * The relay is a round trip to Telegram's server, and a call setup sends a
   * burst of packets: holding the gate for each of them would queue every
   * other bridge call behind the burst. The work still finishes — the
   * Durable Object waits for a promise passed to `waitUntil` before it may be
   * evicted — it just no longer holds the object hostage while it runs.
   */
  private relaySignaling(callId: string, data: string): void {
    const bytes = decodeBase64(data);
    if (bytes === null || bytes.length === 0 || bytes.length > MAX_SIGNALING_BYTES) {
      return;
    }
    const work = this.host.sendCallSignaling(callId, bytes).catch((error) => {
      log.error('call.signaling_failed', { error });
    });
    const holder = this.state as unknown as { waitUntil?: (promise: Promise<unknown>) => void };
    if (typeof holder.waitUntil === 'function') {
      holder.waitUntil(work);
      return;
    }
    void work;
  }
}
