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
import type { EngineStateDto, ServerSocketMessage, UpdateEvent } from './types';

const POLL_INTERVAL_MS = 2500;

/**
Where the browser stands with Cloudflare Access: being probed, outside the
front door, or through it. Telegram authorization is a separate question
(`state.authorized`) and only matters once Access has let the caller in.
*/
export type AccessStatus = 'checking' | 'anonymous' | 'authenticated';

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
      // The intro probe runs before anyone has signed in through Access, and
      // an Access login redirect is cross-origin: fetch cannot read it and
      // rejects with a TypeError. Treat any non-bridge failure during the
      // probe as "anonymous"; real bridge failures (an ApiError other than
      // 401/403) belong on the checking screen with a retry.
      if (!(failure instanceof ApiError) || isAuthError(failure)) {
        setAccess('anonymous');
        setState(null);
        return;
      }
      reportError(failure);
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
    if (access === 'anonymous' || authorized) return;
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
 * (re)connects, which the app uses to refetch state it may have missed while
 * the socket was down.
 */
export function useUpdatesSocket(enabled: boolean, onUpdate: (update: UpdateEvent) => void, onReady: () => void): boolean {
  const [connected, setConnected] = useState(false);
  const updateRef = useRef(onUpdate);
  const readyRef = useRef(onReady);

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

    const connect = (): void => {
      if (stopped) return;
      const current = new WebSocket(updatesSocketUrl());
      socket = current;
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
        else if (message.type === 'ready') readyRef.current();
      });
      current.addEventListener('close', () => {
        setConnected(false);
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

  return enabled && connected;
}
