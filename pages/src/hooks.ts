import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ApiError,
  cancelLogin,
  getState,
  isAuthError,
  startPhoneLogin,
  startQr,
  submitLoginCode,
  submitPassword,
  updatesSocketUrl,
} from './api';
import type { ClientSocketMessage, EngineStateDto, ServerSocketMessage, UpdateEvent } from './types';

const POLL_INTERVAL_MS = 2500;

/**
Whether the app can reach its API at all.

The Access probe and a dead network both fail as a `TypeError` from `fetch`:
the first because the edge redirects to a cross-origin login page that `fetch`
cannot read, the second because there is no network. `/api/health` is public
and same-origin, so it answers exactly when the network is up — and the answer
tells the two apart.
*/
async function canReachApi(): Promise<boolean> {
  try {
    const response = await fetch('/api/health', { cache: 'no-store' });
    return response.ok;
  } catch {
    return false;
  }
}

/**
Where the browser stands with Cloudflare Access: being probed, outside the
front door, through it, or nowhere at all because the network is gone.
Telegram authorization is a separate question (`state.authorized`) and only
matters once Access has let the caller in.
*/
export type AccessStatus = 'checking' | 'anonymous' | 'authenticated' | 'offline';

/**
 * The sign-in side of the bridge: probes the Access session, polls the engine
 * while the account is not linked, auto-starts the QR login, and feeds the
 * operator's login code and cloud password back into the flow.
 *
 * `reportError` is exposed because the authenticated half of the app reports
 * its failures — including an expired Cloudflare Access session — through the
 * same two slots.
 */
export interface LoginFlowState {
  state: EngineStateDto | null;
  access: AccessStatus;
  error: string | null;
  reportError: (failure: unknown) => void;
  retryAccess: () => void;
  onPhone: (phone: string) => Promise<void>;
  onCode: (code: string) => Promise<void>;
  onPassword: (password: string) => Promise<void>;
  onRetry: () => void;
  /**
  Drops the snapshot, e.g. right after a logout.
  */
  reset: () => void;
}

export function useLoginFlow(): LoginFlowState {
  const [state, setState] = useState<EngineStateDto | null>(null);
  const [access, setAccess] = useState<AccessStatus>('checking');
  const [error, setError] = useState<string | null>(null);

  const reportError = useCallback((failure: unknown): void => {
    if (isAuthError(failure)) {
      setAccess('anonymous');
      setState(null);
      return;
    }
    setError(failure instanceof Error ? failure.message : String(failure));
  }, []);

  const refreshState = useCallback(async (): Promise<void> => {
    let next: EngineStateDto;
    try {
      next = await getState();
    } catch (failure) {
      if (failure instanceof ApiError) {
        // The bridge answered: Access rejected the session, so the reader is
        // outside the front door. The network is up by definition.
        if (isAuthError(failure)) {
          setAccess('anonymous');
          setState(null);
          return;
        }
        reportError(failure);
        return;
      }
      // The fetch itself failed. That is either the edge redirecting to the
      // Access login page or a network that is not there; the public health
      // endpoint tells them apart.
      if (await canReachApi()) {
        setAccess('anonymous');
        setState(null);
        return;
      }
      setAccess('offline');
      setState(null);
      return;
    }
    // A successful probe is proof of the Access session even if the Telegram
    // leg below fails: that error belongs on the login screen, not the intro.
    setAccess('authenticated');
    if (!next.authorized && next.phase === 'unauthorized') {
      try {
        next = await startQr();
      } catch (failure) {
        reportError(failure);
        return;
      }
    }
    setState(next);
    setError(null);
  }, [reportError]);

  const authorized = state?.authorized ?? false;

  useEffect(() => {
    // Nothing to poll without Access; the sign-in button runs the edge flow.
    // Offline is not polled either: the browser says when the network is back.
    if (access === 'anonymous' || access === 'offline' || authorized) return;
    let stopped = false;
    const run = async (): Promise<void> => {
      if (stopped) return;
      await refreshState();
    };
    void run();
    const id = setInterval(() => void run(), POLL_INTERVAL_MS);
    // Browsers throttle timers in hidden tabs, so the QR on screen can be
    // seconds-to-minutes old by the time the user switches back to scan it:
    // poll immediately on return, before they can read a dead code.
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') void run();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [access, authorized, refreshState]);

  const applyLogin = useCallback(
    async (run: () => Promise<EngineStateDto>): Promise<void> => {
      try {
        setState(await run());
        setError(null);
      } catch (failure) {
        reportError(failure);
      }
    },
    [reportError],
  );

  const onRetry = useCallback((): void => {
    setError(null);
    void cancelLogin().catch(reportError);
  }, [reportError]);

  const retryAccess = useCallback((): void => {
    setError(null);
    void refreshState();
  }, [refreshState]);

  // The offline screen waits for the network instead of polling it: the
  // browser's own `online` event is the signal that there is something to
  // probe again.
  useEffect(() => {
    if (access !== 'offline') return;
    const onOnline = (): void => retryAccess();
    addEventListener('online', onOnline);
    return () => removeEventListener('online', onOnline);
  }, [access, retryAccess]);

  const reset = useCallback((): void => {
    setState(null);
    setError(null);
  }, []);

  return {
    state,
    access,
    error,
    reportError,
    retryAccess,
    onPhone: useCallback((phone: string) => applyLogin(() => startPhoneLogin(phone)), [applyLogin]),
    onCode: useCallback((code: string) => applyLogin(() => submitLoginCode(code)), [applyLogin]),
    onPassword: useCallback((password: string) => applyLogin(() => submitPassword(password)), [applyLogin]),
    onRetry,
    reset,
  };
}

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
): { connected: boolean; send: (message: ClientSocketMessage) => void } {
  const [connected, setConnected] = useState(false);
  const updateRef = useRef(onUpdate);
  const readyRef = useRef(onReady);
  const socketRef = useRef<WebSocket | null>(null);

  // Latest-callback refs, refreshed after each render.
  useEffect(() => {
    updateRef.current = onUpdate;
    readyRef.current = onReady;
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
        retry = 0;
        setConnected(true);
        current.send(JSON.stringify({ type: 'hello' }));
      });
      current.addEventListener('message', (event) => {
        let message: ServerSocketMessage;
        try {
          message = JSON.parse(String(event.data)) as ServerSocketMessage;
        } catch {
          return;
        }
        if (message.type === 'update') updateRef.current(message.update);
        else if (message.type === 'ready') {
          const resync = ready;
          ready = true;
          readyRef.current(resync);
        }
      });
      current.addEventListener('close', () => {
        setConnected(false);
        if (socketRef.current === current) socketRef.current = null;
        if (stopped) return;
        retry += 1;
        const delay = Math.min(15_000, 500 * 2 ** Math.min(retry, 5));
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
