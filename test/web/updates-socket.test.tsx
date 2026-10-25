import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useUpdatesSocket } from '../../apps/web/src/hooks';

/**
 * The updates socket's failure paths.
 *
 * An error frame used to be parsed and dropped, so a dead session looked like
 * an idle one. The reconnect cadence matters for the same reason: each retry
 * is a Worker request, and a socket that opens and immediately closes must
 * not retry in a tight loop.
 */

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static readonly instances: FakeWebSocket[] = [];

  readyState = FakeWebSocket.CONNECTING;
  readonly listeners = new Map<string, Array<(event: unknown) => void>>();
  readonly sent: string[] = [];

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type: string, listener: (event: unknown) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  removeEventListener(): void {}

  send(payload: string): void {
    this.sent.push(payload);
  }

  close(): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.emit('close', {});
  }

  emit(type: string, event: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.emit('open', {});
  }

  message(message: unknown): void {
    this.emit('message', { data: JSON.stringify(message) });
  }
}

function mount(overrides: { onError?: (message: string) => void } = {}) {
  const onUpdate = vi.fn();
  const onReady = vi.fn();
  const onError = overrides.onError ?? vi.fn();
  const hook = renderHook(() => useUpdatesSocket(true, onUpdate, onReady, onError));
  return { ...hook, onUpdate, onReady, onError };
}

function latest(): FakeWebSocket {
  return FakeWebSocket.instances.at(-1)!;
}

beforeEach(() => {
  FakeWebSocket.instances.length = 0;
  vi.useFakeTimers();
  vi.stubGlobal('WebSocket', FakeWebSocket);
  // Jitter is drawn from `crypto`; pin it to the middle of the ±20% window so
  // the backoff boundaries are exact.
  vi.spyOn(crypto, 'getRandomValues').mockImplementation(<T extends ArrayBufferView | null>(array: T): T => {
    if (array instanceof Uint32Array) array[0] = 0x80_00_00_00;
    return array;
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('useUpdatesSocket', () => {
  it('surfaces an error frame from the engine', () => {
    const { onError } = mount();
    const socket = latest();
    act(() => socket.open());
    act(() => socket.message({ type: 'error', message: 'Not signed in' }));
    expect(onError).toHaveBeenCalledWith('Not signed in');
  });

  it('resyncs only on a reconnect, not on the boot socket', () => {
    const { onReady } = mount();
    act(() => latest().open());
    act(() => latest().message({ type: 'ready' }));
    expect(onReady).toHaveBeenLastCalledWith(false);

    act(() => latest().close());
    vi.advanceTimersByTime(1000);
    act(() => latest().open());
    act(() => latest().message({ type: 'ready' }));
    expect(onReady).toHaveBeenLastCalledWith(true);
  });

  it('backs off longer when a socket closes without ever saying ready', () => {
    const { onReady } = mount();
    act(() => latest().open());
    act(() => latest().close());

    // The first retry is 1s, not the 500ms of a reset-on-open cadence.
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(FakeWebSocket.instances).toHaveLength(1);
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(FakeWebSocket.instances).toHaveLength(2);

    act(() => latest().open());
    act(() => latest().close());
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(FakeWebSocket.instances).toHaveLength(2);
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(FakeWebSocket.instances).toHaveLength(3);

    // A ready socket resets the cadence.
    act(() => latest().open());
    act(() => latest().message({ type: 'ready' }));
    expect(onReady).toHaveBeenCalled();
    act(() => latest().close());
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(FakeWebSocket.instances).toHaveLength(4);
  });

  it('sends only while the socket is open', () => {
    const { result } = mount();
    const socket = latest();
    act(() => result.current.send({ type: 'ping' }));
    expect(socket.sent).toHaveLength(0);
    act(() => socket.open());
    act(() => result.current.send({ type: 'ping' }));
    expect(socket.sent).toContain(JSON.stringify({ type: 'ping' }));
  });

  it('ignores a frame that is not JSON', () => {
    const { onUpdate, onReady, onError } = mount();
    const socket = latest();
    act(() => socket.open());
    act(() => socket.emit('message', { data: 'not json' }));
    act(() => socket.emit('message', { data: 'null' }));
    expect(onUpdate).not.toHaveBeenCalled();
    expect(onReady).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });
});
