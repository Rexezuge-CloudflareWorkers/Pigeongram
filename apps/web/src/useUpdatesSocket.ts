import { useCallback, useEffect, useRef, useState } from 'react';
import { updatesSocketUrl } from './api';
import type { ClientSocketMessage, ServerSocketMessage, UpdateEvent } from './types';

/**
 * Keeps one `/user/updates` socket attached, reconnecting with capped backoff.
 *
 * `onUpdate` receives live bridge events; `onReady` fires whenever the socket
 * (re)connects. Its argument says whether the app should resync the state it
 * may have missed: the first socket after a sign-in is the boot's own
 * connection, and the app has just read everything it needs — a later socket
 * means the connection dropped.
 *
 * The returned `send` puts a message on the socket. It exists for the
 * signalling packets of a call: they ride the socket rather than
 * `POST /user/rpc`, because a WebSocket message is not a Worker request and a
 * call setup sends a burst of them.
 */
export function useUpdatesSocket(
  enabled: boolean,
  onUpdate: (update: UpdateEvent) => void,
  onReady: (resync: boolean) => void,
  onError: (message: string) => void = () => {},
): { connected: boolean; send: (message: ClientSocketMessage) => void } {
  const [connected, setConnected] = useState(false);
  const updateRef = useRef(onUpdate);
  const readyRef = useRef(onReady);
  const errorRef = useRef(onError);
  const socketRef = useRef<WebSocket | null>(null);

  // Latest-callback refs, refreshed after each render.
  useEffect(() => {
    updateRef.current = onUpdate;
    readyRef.current = onReady;
    errorRef.current = onError;
  });

  useEffect(() => {
    if (!enabled) return;

    let stopped = false;
    let socket: WebSocket | null = null;
    let retry = 0;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    // Whether this socket has already said `ready`. The first one is the
    // boot's own connection; every socket after it is a reconnect.
    let ready = false;

    const connect = (): void => {
      if (stopped) return;
      const current = new WebSocket(updatesSocketUrl());
      socket = current;
      socketRef.current = current;
      current.addEventListener('open', () => {
        setConnected(true);
        current.send(JSON.stringify({ type: 'hello' }));
      });
      current.addEventListener('message', (event) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(String(event.data));
        } catch {
          return;
        }
        if (typeof parsed !== 'object' || parsed === null) return;
        const message = parsed as ServerSocketMessage;
        switch (message.type) {
          case 'update': {
            updateRef.current(message.update);
            break;
          }
          case 'ready': {
            // The socket has completed the protocol handshake, so the
            // connection works. Resetting on `open` instead would let a socket
            // that opens and immediately closes retry every 500 ms forever.
            retry = 0;
            const resync = ready;
            ready = true;
            readyRef.current(resync);

            break;
          }
          case 'error': {
            // The engine reports "Not signed in" and live-session failures on
            // this frame; dropping it leaves the reader with a dead tab and no
            // explanation.
            errorRef.current(message.message);

            break;
          }
          // No default
        }
      });
      current.addEventListener('close', () => {
        setConnected(false);
        if (socketRef.current === current) socketRef.current = null;
        if (stopped) return;
        retry += 1;
        const base = Math.min(15_000, 500 * 2 ** Math.min(retry, 5));
        // ±20% jitter, so a fleet reconnecting after an outage does not
        // hammer the engine in lockstep.
        const delay = Math.round(base * (0.8 + jitter() * 0.4));
        retryTimer = setTimeout(connect, delay);
      });
      current.addEventListener('error', () => {
        // `close` (and thus the reconnect timer) follows a failed socket; make
        // sure a socket that errored before opening does not linger.
        if (current.readyState === WebSocket.CONNECTING || current.readyState === WebSocket.OPEN) {
          current.close();
        }
      });
    };

    connect();
    const ping = setInterval(() => {
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'ping' }));
      }
    }, 25_000);

    return () => {
      stopped = true;
      clearInterval(ping);
      if (retryTimer !== undefined) clearTimeout(retryTimer);
      socket?.close();
    };
  }, [enabled]);

  const send = useCallback((message: ClientSocketMessage): void => {
    const socket = socketRef.current;
    if (socket?.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify(message));
  }, []);

  return { connected: enabled && connected, send };
}

/**
 * A random fraction in [0, 1].
 *
 * The reconnect backoff only needs an even spread, not unpredictability, but
 * `crypto` is what the library forbids substituting with `Math.random`; a
 * Uint32 has enough resolution for the ±20% window.
 *
 * The divisor stays `2^32 - 1` rather than `2^32` on purpose: that is the one
 * division CodeQL's `js/biased-cryptographic-random` accepts as an unbiased
 * reduction of a secure random value (it only whitelists `2^n - 1`), and the
 * endpoints it adds cost nothing to a jitter.
 */
const JITTER_MAX = 0xff_ff_ff_ff;

function jitter(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0] / JITTER_MAX;
}
