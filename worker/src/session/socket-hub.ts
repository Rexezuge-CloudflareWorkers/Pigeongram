import type { ClientSocketMessage, ServerSocketMessage } from '../types';

/**
What the hub needs from the engine: the live-session lifecycle.
*/
export interface SocketHubHost {
  /**
  Connects (or joins) the live session; called when a client says hello.
  */
  ensureLive(): Promise<void>;
  /**
  Releases the live session once the last socket detaches.
  */
  stopLive(): Promise<void>;
}

/**
 * The `/user/updates` fan-out.
 *
 * Sockets are accepted with the hibernation API, so the engine is woken by
 * `webSocketMessage`/`webSocketClose` rather than by live listeners. The
 * protocol is intentionally tiny: `hello` (client attached, go live) and
 * `ping` (keepalive), answered by `ready` and `pong`; engine events ride on
 * `update`, and state failures are broadcast as `error`.
 */
export class UpdatesSocketHub {
  constructor(
    private readonly state: DurableObjectState,
    private readonly host: SocketHubHost,
  ) {}

  /**
  Accepts a socket. The live session is started by `hello`, not by the accept
  itself: a socket that never speaks the protocol must not open a connection
  (and must not consume a broadcast of the engine's answer).
  */
  accept(): Response {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    this.state.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  async onMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const text = typeof message === 'string' ? message : new TextDecoder().decode(message);
    let parsed: ClientSocketMessage;
    try {
      parsed = JSON.parse(text) as ClientSocketMessage;
    } catch {
      return;
    }
    if (parsed.type === 'ping') {
      socket.send(JSON.stringify({ type: 'pong' } satisfies ServerSocketMessage));
      return;
    }
    if (parsed.type !== 'hello') {
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
}
