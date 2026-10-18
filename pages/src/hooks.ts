import { useCallback, useEffect, useRef, useState } from 'react';
import {
  cancelLogin,
  getState,
  getToken,
  isGateError,
  setToken as persistToken,
  startPhoneLogin,
  startQr,
  submitLoginCode,
  submitPassword,
  updatesSocketUrl,
} from './api';
import type { EngineStateDto, ServerSocketMessage, UpdateEvent } from './types';

const POLL_INTERVAL_MS = 2500;

/**
 * The sign-in side of the bridge: polls the engine while the account is not
 * linked, auto-starts the QR login, and feeds the operator's token, login code
 * and cloud password back into the flow.
 *
 * `reportError` is exposed because the authenticated half of the app reports
 * its failures — including the token gate — through the same two slots.
 */
export interface LoginFlowState {
  state: EngineStateDto | null;
  gate: boolean;
  error: string | null;
  reportError: (failure: unknown) => void;
  onToken: (token: string) => void;
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
  const [gate, setGate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState(getToken());

  const reportError = useCallback((failure: unknown): void => {
    if (isGateError(failure)) {
      setGate(true);
      return;
    }
    setError(failure instanceof Error ? failure.message : String(failure));
  }, []);

  const refreshState = useCallback(async (): Promise<void> => {
    try {
      let next = await getState();
      if (!next.authorized && next.phase === 'unauthorized') next = await startQr();
      setState(next);
      setGate(false);
      setError(null);
    } catch (failure) {
      reportError(failure);
    }
    // `token` is a dependency: saving a new token restarts the poll.
  }, [reportError, token]);

  const authorized = state?.authorized ?? false;

  useEffect(() => {
    if (authorized) return;
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
  }, [authorized, refreshState]);

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

  const onToken = useCallback((value: string): void => {
    persistToken(value);
    setToken(value);
    setGate(false);
    setError(null);
  }, []);

  const onRetry = useCallback((): void => {
    setError(null);
    void cancelLogin().catch(reportError);
  }, [reportError]);

  const reset = useCallback((): void => {
    setState(null);
    setError(null);
  }, []);

  return {
    state,
    gate,
    error,
    reportError,
    onToken,
    onPhone: useCallback((phone: string) => applyLogin(() => startPhoneLogin(phone)), [applyLogin]),
    onCode: useCallback((code: string) => applyLogin(() => submitLoginCode(code)), [applyLogin]),
    onPassword: useCallback((password: string) => applyLogin(() => submitPassword(password)), [applyLogin]),
    onRetry,
    reset,
  };
}

/**
 * Keeps one `/api/updates` socket attached, reconnecting with capped backoff.
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
